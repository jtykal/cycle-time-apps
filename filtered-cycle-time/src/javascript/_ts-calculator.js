Ext.define('CycleCalculator', {
//    extend: "Rally.data.lookback.calculator.BaseCalculator",
    logger: new Rally.technicalservices.Logger(),
    config: {
        cycleField: 'ScheduleState',
        cycleStartValue: 'Defined',
        cycleEndValue: 'Accepted',
        cyclePrecedence: [],
        startDate: null,
        endDate: null,
        granularity: "month",
        dateFormat: "M yyyy",
        dataFilters: [],
        color: {
            Defect:'red',
            HierarchicalRequirement: 'green',
            Combined: 'blue'
        }
    },
    snapsByOid: {},
    constructor: function (config) {
        this.mergeConfig(config);
    },
    runCalculation: function(snapshots) {   
         console.log(snapshots);
         var snaps_by_oid = Rally.technicalservices.Toolbox.aggregateSnapsByOid(snapshots);
         console.log('snapsbyoid', Ext.Object.getKeys(snaps_by_oid).length);
         var date_buckets = Rally.technicalservices.Toolbox.getDateBuckets(this.startDate, this.endDate, this.granularity);
         console.log('date_buckets',date_buckets);
         var cycle_time_data = [];
         
         Ext.Object.each(snaps_by_oid, function(oid, snaps){
             var ctd = this._getCycleTimeData(snaps, this.cycleField, this.cycleStartValue, this.cycleEndValue, this.cyclePrecedence);
             if (ctd.include){
                 cycle_time_data.push(ctd);
             }
         },this);
         
         console.log('cycleTmeDAta',cycle_time_data.length);
         
         var series = [];
         console.log(this.color);
         series.push(this._getSeries(cycle_time_data, date_buckets, this.granularity,undefined,this.color.Combined));  
         var hr_series = this._getSeries(cycle_time_data, date_buckets, this.granularity,'HierarchicalRequirement',this.color.HierarchicalRequirement);
         series.push(hr_series);  
         
         var defect_series = this._getSeries(cycle_time_data, date_buckets, this.granularity,'Defect',this.color.Defect);
         series.push(defect_series);  
         
         series.push(this._getTrendline(hr_series));
         series.push(this._getTrendline(defect_series));

         categories = Rally.technicalservices.Toolbox.formatDateBuckets(date_buckets,this.dateFormat);
         
         return {
            series: series,
            categories: categories
        }
    },

    _getTrendline: function(series, color){
        /**
         * Regression Equation(y) = a + bx  
         * Slope(b) = (NΣXY - (ΣX)(ΣY)) / (NΣX2 - (ΣX)2) 
         * Intercept(a) = (ΣY - b(ΣX)) / N
         */

        var sum_xy = 0;
        var sum_x = 0;
        var sum_y = 0;
        var sum_x_squared = 0;
        var n = 0;  
        for (var i=0; i<series.data.length; i++){
            if (series.data[i]){
                sum_xy += series.data[i] * i;
                sum_x += i;
                sum_y += series.data[i];
                sum_x_squared += i * i;
                n++;
            }
        }
        var slope = (n*sum_xy - sum_x * sum_y)/(n*sum_x_squared - sum_x * sum_x);
        var intercept = (sum_y - slope * sum_x)/n;  

        this.logger.log('trendline data (name, slope, intercept)',series.name, slope, intercept);
        
        var y = new Array(series.data.length);
        for (var i =0; i<series.data.length; i++){
            if (isNaN(intercept) || isNaN(slope)) {
                y[i] = null;  
                
            } else {
                y[i] = intercept + slope * i;  
            }
        }
        this.logger.log('_getTrendline', y);
        return {
             name: series.name + ' trend',
             color: color,
             data: y,
             display: 'line',
             dashStyle: 'Dash'
         };

    },
    _getCycleTimeData: function(snaps, field, startValue, endValue, precedence){
        var start_index = -1;  
        if (startValue != null){  //This is in case there is no start value (which means grab the first snapshot)
            var start_index = _.indexOf(precedence, startValue);
        }
        var end_index = _.indexOf(precedence, endValue);

        var include = false; 
        
        //Assumes snaps are stored in ascending date order.  
        var start_date = null, end_date = null, between_states = false, days = null; 
        var type = snaps[0]._TypeHierarchy.slice(-1)[0];
        Ext.each(snaps, function(snap){
            var state_index = -1;  
            if (snap[field]){
                state_index = _.indexOf(precedence, snap[field]);
            }
            if (state_index >= start_index && start_date == null){
                start_date = Rally.util.DateTime.fromIsoString(snap._ValidFrom);  
                between_states = true;  
            }
            
            if (between_states && state_index >= end_index){
                end_date = Rally.util.DateTime.fromIsoString(snap._ValidFrom);
                if (start_date != null){
                    days = Rally.util.DateTime.getDifference(end_date,start_date,"day");
                }
                between_states = false;  
                include = this._snapMeetsFilterCriteria(snap);
            }
            
        }, this);
        
        return {days: days, endDate: end_date, startDate: start_date, artifactType: type, include: include };
    },
    _snapMeetsFilterCriteria: function(snap){
        var is_filtered = true;
        this.logger.log('_snapMeetsFilterCriteria', snap);
        Ext.each(this.dataFilters, function(filter){
            var str_format = "{0} {1} {2}";
            if (isNaN(snap[filter.property]) && isNaN(filter.value)){
                str_format = "\"{0}\" {1} \"{2}\"";
            }
            var operator = filter.operator;
            if (operator == "="){
                operator = "==";
            }
            
            var val = filter.value || '';
            if (val.length == 0 || snap[filter.property].length == 0){
                is_filtered = (val.length == 0 && snap[filter.property].length == 0);  
                this.logger.log('_snapMeetsFilterCriteria filter property or value is blank', filter.property, snap[filter.property], is_filtered);
            } else {
                var str_eval = Ext.String.format(str_format, snap[filter.property], operator, val);
                is_filtered = eval(str_eval);
                this.logger.log('_snapMeetsFilterCriteria eval', filter, str_eval,is_filtered);
            }
            return is_filtered;  //if filtered is false, then we want to stop looping.  
        },this);
        
        return is_filtered;  
    },
    _getSeries: function(cycle_time_data, date_buckets, granularity, type, color){
        var series_raw_data = [];
        var series_data = [];
        for (var i=0; i<date_buckets.length; i++){
            series_raw_data[i] = [];
            series_data = 0;
        }
        
        Ext.each(cycle_time_data, function(cdata){
            for (var i=0; i<date_buckets.length; i++){
                if ((type == undefined || type == cdata.artifactType) && cdata.endDate >= date_buckets[i] && cdata.endDate < Rally.util.DateTime.add(date_buckets[i],granularity,1)){
                    series_raw_data[i].push(cdata.days)
                }
            }
        });

        var series_data = new Array(series_raw_data.length);
        _.map(series_data, function(){return null});
        for (var i=0; i<series_raw_data.length; i++){
            if (series_raw_data[i].length > 0){
                series_data[i] = Ext.Array.mean(series_raw_data[i]);
            } else {
                series_data[i]=null;
            }
        }

        return {
             name: this._getSeriesName(type),
             color: color,
             data: series_data,
          //   display: 'line'
         };
    },
    _getSeriesName: function(type){
        var type_text = "Combined";
        if (type) {
            type_text = type;
            if (type == 'HierarchicalRequirement'){
                type_text = "User Story";
            }
        }
        return Ext.String.format(type_text);   
    },
});