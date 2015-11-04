;(function($) {

    /**
     * cognition.js (v1.0.6)
     *
     * Copyright (c) 2015 Scott Southworth, Landon Barnickle & Contributors
     *
     * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this
     * file except in compliance with the License. You may obtain a copy of the License at:
     * http://www.apache.org/licenses/LICENSE-2.0
     *
     * Unless required by applicable law or agreed to in writing, software distributed under
     * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF
     * ANY KIND, either express or implied. See the License for the specific language
     * governing permissions and limitations under the License.
     *
     * @authors Scott Southworth @DarkMarmot, Landon Barnickle @landonbar
     *
     */
    "use strict";
    var ndash = $.ndash = $.cognition = {};
    var bus = ndash.bus = $.catbus = catbus;
    var uid = 0;

    var COG_ROOT = bus.demandTree('COG_ROOT');
    var ALIAS_ROOT= bus.demandTree('ALIAS_ROOT');

    var buildNum = 'NEED_BUILD_NUM';

    var sessionTimestamp = Date.now();
    var DEBUG = true;

    // common options list
    var LOCAL = 'local';
    var OUTER = 'outer';
    var PARENT = 'parent';
    var FIRST = 'first';
    var LAST  = 'last';
    var ALL = 'all';
    var NONE = 'none';

    // cognition data types

    var DATA = 'data';
    var NUMBER = 'number';
    var PROP = 'prop';
    var CONFIG = 'config';
    var FEED = 'feed';
    var SERVICE = 'service';
    var STRING = 'string';
    var RUN = 'run';
    var ERROR = 'error';
    var BOOLEAN = 'bool';
    var OBJECT = 'object';
    var READ = 'read';

    // the value attribute of of a data tag can be preceded by one of these:
    var DATA_VALUE_TYPE_HASH = {

        data: DATA,
        num: NUMBER,
        number: NUMBER,
        prop: PROP,
        c: CONFIG,
        config: CONFIG,
        bool: BOOLEAN,
        boolean: BOOLEAN,
        string: STRING,
        run: RUN,
        error: ERROR,
        read: READ

    };

    ndash.buildNum = function(n){
        if(arguments.length == 0) return buildNum;
        buildNum = n;
        return ndash;
    };



    var defaultScriptDataPrototype = {

        _ids: {},
        enter: function () {
        },
        update: function () {
        },
        exit: function () {
            if (this.mapItem)
                this.mapItem.destroy();
        },
        init: function () {
        },
        start: function () {
        },
        destroy: function () {
        }

    };

    function getNextUid(){ return ++uid;}

    var activeScriptData = null;
    var activeProcessURL = null;


    var contentMap = {}; // layout map, built from n-item hierarchy
    var cacheMap = {}; // cache of content url loads
    var declarationMap = {}; // arrays of strategy directives
    var libraryMap = {}; // by resolvedUrl, javascript files processed (don't run again)

    var requestMap = {}; // active content url requests
    var scriptMap = {}; // prototypes


    var cogDownloadMap = {}; // data locations by url, store true when file downloaded
    var cogDependenciesMap = {}; // data locations by url, store true when dependencies downloaded

    // sensors track dependencies and write true when complete

    function downloadCog(resolvedUrl){

        if(cogDownloadMap[resolvedUrl])
            return; // already done or in process

        tryToDownload(resolvedUrl);

        var cogDownloadStatus = cogDownloadMap[resolvedUrl] = bus.location("n-cog:" + resolvedUrl);
        var fileStatus = bus.location("n-url:" + resolvedUrl);
        fileStatus.on('done').transform(true).pipe(cogDownloadStatus).once().autorun();

    }

    ndash._contentMap = contentMap;
    ndash._cacheMap = cacheMap;
    ndash._declarationMap = declarationMap;

    ndash.masterId = 0;

    var webServiceDefaults = {

        format: 'jsonp',
        post: false

    };

    function log(postcard){
        //console.log(postcard.topic + ":" + postcard.msg);
    }

    function destroyInnerMapItems(into){
        for(var k in into.childMap){
            var mi = into.childMap[k];

            destroyMapItem(mi);
        }
    }


    $.cog = ndash.use = function(scriptData){
        activeScriptData = scriptData;
        // add default methods to this nascent prototype if not present
        $.each(defaultScriptDataPrototype, function(name, func){
            if(typeof scriptData[name] !== 'function')
                scriptData[name] = func;
        });
    };

    ndash.init = function (sel, url, debugUrl){

        var root = ndash.root = new MapItem();
        root.aliasZone = ALIAS_ROOT;
        root.cogZone = COG_ROOT;


        bus.defineDeepLinker('lzs', function(dir){ return LZString.compressToEncodedURIComponent(JSON.stringify(dir))},
            function(str){ return JSON.parse(LZString.decompressFromEncodedURIComponent(str))});
        bus.setDeepLinker('lzs');

        var directions = bus.resolveDirections(window.location.search);
        if(directions)
            COG_ROOT.demandData('__DIRECTIONS__').write(directions);

        root.localSel = sel;
        root.createCog({url:url});
        if(debugUrl)
            root.createCog({url: debugUrl});

    };

    function destroyMapItem(mapItem){

        for(var k in mapItem.childMap){
            var mi = mapItem.childMap[k];
            destroyMapItem(mi);
        }

        if(mapItem.parent){
            delete mapItem.parent.childMap[mapItem.uid];
        }

        bus.dropHost(mapItem.uid);
        mapItem.cogZone.drop();

        if(!mapItem.scriptData)
        {
            console.log("what?");
        }

        mapItem.scriptData.destroy();

        if(mapItem.localSel)
            mapItem.localSel.remove();
        mapItem.localSel = null;
        if(mapItem.scriptData)
            mapItem.scriptData.mapItem = null;
        mapItem.scriptData = null;
        mapItem.parent = null;
        mapItem.itemPlace = null;
        mapItem.destroyed = true;
        mapItem.requirements = null;

        var stored = contentMap[mapItem.uid];
        if(stored === mapItem) {
            delete contentMap[mapItem.uid];
           // console.log("destroyed " + mapItem.uid);
        }
      //  if (DEBUG) //console.log("DESTROYED:"+mapItem.uid+":"+mapItem.path);
    }


    function extractHasAttr(sel, attrName){
        return sel.length > 0 && sel[0].hasAttribute(attrName);
    }

    function extractString(sel, attrNameOrNames, defaultValue){

        var attrValue = determineFirstDefinedAttrValue(sel, attrNameOrNames);
        if(attrValue)
            return attrValue.trim();
        return defaultValue;

        //return (typeof value === 'string') ? value.trim() : value;
    }

    function extractBool(sel, attrNameOrNames, defaultValue){

        var attrValue = determineFirstDefinedAttrValue(sel, attrNameOrNames);

        if(attrValue === undefined)
            return defaultValue;
        if(attrValue === 'true')
            return true;
        if(attrValue === 'false')
            return false;

        throwParseError(sel, 'bool', attrNameOrNames);

    }

    function extractStringArray(sel, attrNameOrNames){

        var attrValue = determineFirstDefinedAttrValue(sel, attrNameOrNames);
        if(attrValue)
            return stringToStringArray(attrValue);
        return [];

    }

    function stringToStringArray(str){

        var arr = str.split(',');

        for(var i = arr.length - 1; i >= 0; i--){
            var chunk = arr[i];
            var trimmed_chunk = chunk.trim();
            if(!trimmed_chunk)
                arr.splice(i, 1);
            else if(trimmed_chunk.length !== chunk.length)
                arr.splice(i, 1, trimmed_chunk);
        }

        return arr;

    }


    function determineFirstDefinedAttrValue(sel, attrNameOrNames){

        var arr = stringToStringArray(attrNameOrNames);
        for(var i = 0; i < arr.length; i++){
            var attrValue = sel.attr(arr[i]);
            if(attrValue !== undefined)
                return attrValue;
        }
        return undefined;
    }


    function extractCommandDef(sel){

        var d = {

            name: extractString(sel, 'name'),
            pipe: extractString(sel, 'pipe'),
            filter: extractString(sel, 'filter'),
            topic: extractString(sel, 'on', 'update'),
            run: extractString(sel, 'run'),
            emit: extractString(sel, 'emit'),
            emitPresent: extractHasAttr(sel, 'emit'),
            emitType: null,
            once: extractBool(sel, 'once'),
            change: extractBool(sel, 'change', false),
            extract: extractString(sel, 'extract'),
            transform: extractString(sel, 'transform'),
            transformPresent: extractHasAttr(sel, 'transform'),
            transformType: null,
            adapt: extractString(sel, 'adapt'),
            adaptPresent: extractHasAttr(sel, 'adapt'),
            adaptType: null,
            autorun: false,
            batch: extractBool(sel, 'batch'),
            keep: 'last', // first, all, or last
            need: extractStringArray(sel, 'need'),
            gather: extractStringArray(sel, 'gather'),
            defer: extractBool(sel, 'defer')

        };

        d.watch = [d.name];

        // gather needs and cmd -- only trigger on cmd
        if(d.gather.length || d.need.length) {
            d.gather.push(d.name);

            for (var i = 0; i < d.need.length; i++) {
                var need = d.need[i];
                if (d.gather.indexOf(need) === -1)
                    d.gather.push(need);
            }
        }

        d.batch = d.batch || d.run;
        d.group = d.batch; // todo make new things to avoid grouping and batching with positive statements
        d.retain = d.group;

        applyFieldType(d, 'transform', PROP);
        applyFieldType(d, 'emit', STRING);
        applyFieldType(d, 'adapt', PROP);

        return d;

    }


    function extractSensorDef(sel){

        var d = {

            // add by('tag') default -- or topic, or name, or index
            // add index('field') -- for by() method -- or group(function(msg, topic, tag) return string?

            name: extractString(sel, 'data'),
            cmd: extractString(sel, 'cmd'),
            watch: extractStringArray(sel, 'watch'),
            detect: extractString(sel, 'detect'),
            data: extractString(sel, 'data'),
            find: extractString(sel, 'id,find,node'), // todo switch all to id
            optional: extractBool(sel, 'optional'),
            subs: null,
            where: extractString(sel, 'where', 'first'),
            thing: extractString(sel, 'is', 'data'), // data, feed, service
            pipe: extractString(sel, 'pipe'),
            demand: extractString(sel, 'demand'),
            pipeWhere: extractString(sel, 'pipeWhere', 'first'), // first, last, local, outer -- todo switch to prop based
            filter: extractString(sel, 'filter'),
            topic: extractString(sel, 'for,on,topic', 'update'),
            run: extractString(sel, 'run'),
            emit: extractString(sel, 'emit'),
            emitPresent: extractHasAttr(sel, 'emit'),
            emitType: null,
            once: extractBool(sel, 'once'),
            retain: extractBool(sel, 'retain'),
            group: extractBool(sel, 'group'),
            change: extractBool(sel, 'change,distinct,skipDupes', false),
            extract: extractString(sel, 'extract'),
            transform: extractString(sel, 'transform'),
            transformPresent: extractHasAttr(sel, 'transform'),
            transformType: null,
            adapt: extractString(sel, 'adapt'),
            adaptPresent: extractHasAttr(sel, 'adapt'),
            adaptType: null,
            autorun: extractBool(sel, 'now,auto,autorun'),
            batch: extractBool(sel, 'batch'),
            keep: extractString(sel, 'keep', 'last'), // first, all, or last
            need: extractStringArray(sel, 'need,needs'),
            gather: extractStringArray(sel, 'gather'),
            defer: extractBool(sel, 'defer')

        };

        var i;

        // add needs to the watch
        for(i = 0; i < d.need.length; i++){
            var need = d.need[i];
            if(d.watch.indexOf(need) === -1)
                d.watch.push(need);
        }

        // add cmd to the watch list
        if(d.cmd && d.watch.indexOf(d.cmd) === -1)
            d.watch.push(d.cmd);

        // add watches to the gathering -- if gathering
        if(d.gather.length > 0) {
            for (i = 0; i < d.watch.length; i++) {
                var watch = d.watch[i];
                if (d.gather.indexOf(watch) === -1)
                    d.gather.push(watch);
            }
        }

        if(!d.find && !d.cmd) // && d.watch.length > 0)
            d.autorun = true;

        d.batch = d.batch || (d.watch.length > 1); // todo -- allow multiples without batching?
        d.group = d.batch; // todo make new things to avoid grouping and batching with positive statements
        d.retain = d.group;

        applyFieldType(d, 'transform', PROP);
        applyFieldType(d, 'emit', STRING);
        applyFieldType(d, 'adapt', PROP);

        return d;

    }


    function extractPropDef(sel){

        var d = {
            find: extractString(sel, 'find'),
            thing: extractString(sel, 'is', 'data'),
            where: extractString(sel, 'where', 'first'),
            optional: extractBool(sel, 'optional'),
            name: extractString(sel, 'name')
        };

        d.name = d.name || d.find;
        return d;

    }

    function extractWriteDef(sel){
        return {
            name: extractString(sel, 'name'),
            thing: extractString(sel, 'is', 'data'),
            where: extractString(sel, 'where', 'first'),
            value: extractString(sel, 'value')
        };
    }

    function extractValveDef(sel){
        return {
            allow: extractStringArray(sel, 'allow'),
            thing: extractString(sel, 'is', 'data')
        };
    }

    function extractLibraryDef(sel){
        return {
            url: extractString(sel, 'url'),
            path: extractString(sel, 'path'),
            isLibrary: true
        };
    }

    function extractPreloadDef(sel){
        return {
            url: extractString(sel, 'url'),
            path: extractString(sel, 'path'),
            isPreload: true,
            preload: true
        };
    }

    function extractWireDef(sel){
        return {
            url: extractString(sel, 'url'),
            path: extractString(sel, 'path'),
            name: extractString(sel, 'name'),
            isRoute: extractBool(sel, 'route'),
            isWire: true
        };
    }

    function extractAlloyDef(sel){

        var def = {
            name: extractString(sel, 'name'),
            isRoute: extractBool(sel, "route"),
            url: extractString(sel, 'url'),
            path: extractString(sel, 'path'),
            isAlloy: true
        };

        return def;

    }


    function extractServiceDef(sel){

        var d = {
            name: extractString(sel, 'name'),
            to: extractString(sel, 'to'),
            url: extractString(sel, 'url'),
            path: extractString(sel, 'path'),
            topic: extractString(sel, 'on,topic'),
            run: extractString(sel, 'run'),
            post: extractBool(sel, 'post'),
            format: extractString(sel, 'format', 'jsonp'),
            request: extractBool(sel, 'req,request'),
            prop: extractBool(sel, 'prop')
        };


        return d;

    }

    function extractDefaultFeedDefFromServiceDef(def){
        return {
            name: def.name,
            to: def.to,
            service: def.name
        };
    }

    function extractCogDef(sel){

        var d = {

            path: extractString(sel, "path"),
            name: extractString(sel, "name"),
            isRoute: extractBool(sel, "route"),
            url: extractString(sel, "url"),
            source: extractString(sel, 'use') || extractString(sel, 'from,source'),
            item: extractString(sel, 'make') || extractString(sel, 'to,item','cog'),
            target: extractString(sel, "id,find"),
            action: extractString(sel, "and", 'append')

        };

        applyFieldType(d,'url');
        applyFieldType(d,'source', DATA);
        applyFieldType(d,'item', DATA);

        return d;

    }


    function extractChainDef(sel){

        var d = {
            path: extractString(sel, "path"),
            name: extractString(sel, "name"),
            isRoute: extractBool(sel, "route"),
            url: extractString(sel, "url"),
            prop: extractBool(sel, 'prop'),
            source: extractString(sel, "from,source"),
            item: extractString(sel, "to,value,item",'cog'),
            key: extractString(sel, "key"),
            build: extractString(sel, 'build', 'append'), // scratch, append, sort
            order: extractBool(sel, 'order'), // will use flex order css
            depth: extractBool(sel, 'depth'), // will use z-index
            target: extractString(sel, "node,id,find")

        };

        applyFieldType(d, 'source', DATA);
        applyFieldType(d, 'item', DATA);

        return d;

    }

    function extractFeedDef(sel){

        var d = {
            service: extractString(sel, 'service'),
            to: extractString(sel, 'to,data'), // todo decide on to or data
            request: extractBool(sel, 'req,request'),// todo change to extractBool and test
            name: extractString(sel, 'name', false),
            prop: extractBool(sel, 'prop', false)
        };

        d.name = d.name || d.service;

        return d;

    }

    function extractDataDef(sel){

        var d = {
            name: extractString(sel, 'name'),
            inherit: extractBool(sel, 'inherit'),
            isRoute: extractBool(sel, 'route'),
            value: extractString(sel, 'value'),
            valueType: null,
            adapt: extractString(sel, 'adapt'),
            adaptType: null,
            adaptPresent: extractHasAttr(sel, 'adapt'),
            service: extractString(sel, 'service'),
            serviceType: null,
            servicePresent: extractHasAttr(sel, 'service'),
            params: extractString(sel, 'params'),
            paramsType: null,
            paramsPresent: extractHasAttr(sel, 'params'),
            url: extractString(sel, 'url'),
            path: extractString(sel, 'path'),
            verb: extractString(sel, 'verb'),
            prop: extractBool(sel, 'prop'),
            request: extractBool(sel, 'req,request', false) // todo support data loc sensored, if object then acts as params in request
        };

        applyFieldType(d, 'value');
        applyFieldType(d, 'params', PROP);
        applyFieldType(d, 'service');
        applyFieldType(d, 'adapt', PROP);

        return d;

    }

    function stringToSimpleValue(str){

        if(str === 'true'){
            return true;
        } else if(str === 'false'){
            return false;
        } else if(str === 'null'){
            return null;
        } else if(str === '[]'){
            return [];
        } else if(str === '{}'){
            return {};
        } else {
            return str;
        }

    }

    function stringToPrimitive(str, type) {

        if(type === BOOLEAN) {
            return (str === 'true');
        } else if (type === NUMBER) {
            return Number(str);
        } else {
            return str;
        }
    }

    function applyFieldType(d, fieldName, defaultType){

        var str = d[fieldName];
        if(str === undefined) // field was not defined, don't need to assign a type
            return;

        var fieldTypeName = fieldName + "Type";
        var chunks = str.split(" ");

        var typeDeclared = chunks.length > 0 && DATA_VALUE_TYPE_HASH[chunks[0]];
        var type = typeDeclared || defaultType;

        d[fieldTypeName] = type;

        if(chunks.length === 1) { // no prefix for data type given, implicitly coerce to bool or null if appropriate
            d[fieldName] = (type) ? str : stringToSimpleValue(str);
        } else {
            if(typeDeclared) // check to avoid removing part of a string with spaces that didn't specify a type
                chunks.shift();
            str = chunks.join(' ');
            d[fieldName] = stringToPrimitive(str, type);
        }

    }

    function extractConfigDef(sel){

        var d = {
            name: extractString(sel, 'name'),
            inherit: extractBool(sel, 'inherit'),
            value: extractString(sel, 'value'),
            valueType: null,
            prop: extractBool(sel, 'prop')
        };

        applyFieldType(d, 'value');


        return d;

    }

    function extractAliasDef(sel){

        return {
            name: extractString(sel, 'name'),
            path: extractString(sel, 'path'),
            url: extractString(sel, 'url')
        };

    }

    function extractMethodDef(sel){

        var d = {
            name: extractString(sel, 'name'),
            func: extractString(sel, 'func'),
            bound: extractBool(sel, 'bound')
        };

        d.name = d.name || d.func;
        d.func = d.func || d.name;

        return d;
    }

    function extractDeclarations(sel){

        var decs = {};
        var arr, arr2;

        arr = decs.aliases = [];
        var aliases = sel.find("alias");
        aliases.each(function(){
            var aliasDef = extractAliasDef($(this));
            arr.push(aliasDef);
        });

        arr = decs.valves = [];
        var valves = sel.find("valve");
        valves.each(function(){
            var valveDef = extractValveDef($(this));
            arr.push(valveDef);
        });

        arr = decs.dataSources = [];
        var dataSources = sel.find("data");
        dataSources.each(function(){
            var dataDef = extractDataDef($(this));
            arr.push(dataDef);
        });

        arr = decs.configs = [];
        var configs = sel.find("config");
        configs.each(function(){
            var configDef = extractConfigDef($(this));
            arr.push(configDef);
        });

        arr = decs.services = [];
        var services = sel.find("service");
        services.each(function(){
            var serviceDef = extractServiceDef($(this));
            arr.push(serviceDef);
        });

        arr = decs.feeds = [];
        var feeds = sel.find("feed");
        feeds.each(function(){
            var feedDef = extractFeedDef($(this));
            arr.push(feedDef);
        });

        arr = decs.methods = [];
        var methods = sel.find("method");
        methods.each(function(){
            var methodDef = extractMethodDef($(this));
            arr.push(methodDef);
        });

        arr = decs.properties = [];
        var properties = sel.find("prop");
        properties.each(function(){
            var propDef = extractPropDef($(this));
            arr.push(propDef);
        });

        arr = decs.sensors = [];
        var sensors = sel.find("sensor");
        decs.commands = [];
        sensors.each(function(){
            var sensorDef = extractSensorDef($(this));
            arr.push(sensorDef);
            if(sensorDef.cmd)
                decs.commands.push(sensorDef.cmd);
        });

        var commands = sel.find("command");
        commands.each(function(){
            var commandDef = extractCommandDef($(this));
            arr.push(commandDef);
            if(commandDef.name)
                decs.commands.push(commandDef.name);
        });


        arr = decs.writes = [];
        var writes = sel.find("write");
        writes.each(function(){
            var writeDef = extractWriteDef($(this));
            arr.push(writeDef);
        });

        arr = decs.cogs = [];
        var cogs = sel.find("cog");
        cogs.each(function(){
            var cogDef = extractCogDef($(this));
            arr.push(cogDef);
        });

        arr = decs.chains = [];
        var chains = sel.find("chain");
        chains.each(function(){
            var chainDef = extractChainDef($(this));
            arr.push(chainDef);
        });

        // todo -- finish separating this code that uses 'require' tags as the basis for preload and hoist
        // todo -- this should be better once all requirement queues are handled in the bus

        arr = decs.requires = [];
        var requires = sel.find("require");
        requires.each(function(){
            var requireDef = extractLibraryDef($(this));
            arr.push(requireDef);
        });

        arr = decs.requires;
        var hoists = sel.find("hoist,trait,wire,alloy");
        hoists.each(function(){
            var hoistDef = extractWireDef($(this));
            hoistDef.isWire = true;
            hoistDef.isAlloy = true;
            arr.push(hoistDef);
        });

        arr = decs.requires;
        var preloads = sel.find("preload");
        preloads.each(function(){
            var preloadDef = extractPreloadDef($(this));
            preloadDef.preload = preloadDef.isPreload = true;
            arr.push(preloadDef);
        });


        sel.remove();

        return decs;
    }


    var MapItem = function() {

        this.cogZone = null;
        this.aliasZone = null;
        this.origin = null; // hosting cog if this is an alloy

        this.isAlloy = false;
        this.isChain = false;
        this.isPinion = false;

        this.path = null; // local directory
        this.localSel = null;
        this.scriptData = Object.create(defaultScriptDataPrototype);
        this.url = null; // possibly relative url requested
        this.resolvedUrl = null; // fully qualified and resolved url using path
        this.state = null;
        this.name = null;
        this.parent = null;
        this.alloys = [];
        this.serviceMap = {};
        this.feedMap = {};
        this.aliasMap = {};
        this.dataMap = {};
        this.valveMap = null;
        this.methodMap = {};
        this.childMap = {};
        this.webServiceMap = {};
        this.config = {};
        this.itemPlace = null;
        this.uid = ++uid;
        this.destroyed = false;
        this.requirements = [];
        this.requirementsSeen = {};
        this.itemData = null;
        this.lastData = null;
        this.itemKey = null;
        this._declarationDefs = null;

        contentMap[this.uid] = this;

    };

    MapItem.prototype.findCogById = function(uid){
        return contentMap[uid];
    };

    MapItem.prototype.hash = function(arr, key, val){ // todo replace with _.indexBy for all files using it
        var h = {};

        if(typeof key === 'string') {
            var keyField = key;
            key = function (d) {
                return d[keyField];
            };
        }
        if(typeof val === 'undefined')
            val = function(d){ return d;};
        else if(typeof val === 'string') {
            var valField = val;
            val = function (d) {
                return d[valField];
            };
        }

        for(var i = 0; i < arr.length; i++){
            var d = arr[i];
            var k = key(d);
            var v = val(d);
            h[k] = v;
        }

        return h;
    };

    // todo OUCH -- no underscore references should be here -- remove
    MapItem.prototype.createParams = function(parameterMap){
        var params = {};
        var self = this;
        _.forEach(parameterMap, function(val, key){
            params[key] = self.findData(val).read();
        });
        return params;
    };

    MapItem.prototype.createValues = MapItem.prototype.mapValues = function(dataNameArray){
        var values = {};
        var self = this;
        _.forEach(dataNameArray, function(val){
            values[val] = self.findData(val).read();
        });
        return values;
    };

    MapItem.prototype.on = function(topic){
        return this.itemPlace.on(topic);
    };


    MapItem.prototype.tell = MapItem.prototype.write= function(msg, topic) {
        this.itemPlace.write(msg, topic);
    };

    MapItem.prototype.destroy = function(){
        destroyMapItem(this);
    };


    function determinePathFromFullUrl(url){
        var lastSlashPos = url.lastIndexOf("/");
        if(lastSlashPos === 0)
            return "/";
        if(lastSlashPos < url.length - 1 && lastSlashPos > 0)
            url = url.substring(0,lastSlashPos + 1);
        return url;
    }

    // take full url and get directory
    MapItem.prototype._determinePathFromFullUrl = function(url){
        var lastSlashPos = url.lastIndexOf("/");
        if(lastSlashPos === 0)
            return "/";
        if(lastSlashPos < url.length - 1 && lastSlashPos > 0)
            url = url.substring(0,lastSlashPos + 1);
        return url;
    };

    function copyProps(source, target){
        if(source){
            for(var k in source){
                target[k] = source[k];
            }
        }
        return target;
    }

    // const
    var FIRST_COG_DECLARATIONS = [

        {name: 'properties', method: 'createProp'},
        {name: 'valves', method: 'createValve'},
        {name: 'aliases', method: 'createAlias'},
        {name: 'dataSources', method: 'createData'},
        {name: 'commands', method: 'demandData'},
        {name: 'configs', method: 'createConfig2'},
        {name: 'services', method: 'createService'},
        {name: 'feeds', method: 'createFeed'},
        {name: 'methods', method: 'createMethod'}

    ];

    MapItem.prototype._cogFirstBuildDeclarations = function(defs) {

        var self = this;

        for(var i = 0; i < FIRST_COG_DECLARATIONS.length; i++) {

            var declaration = FIRST_COG_DECLARATIONS[i];
            var list = defs[declaration.name]; // list of declarations of a certain type (data, valve, etc.)
            var method = self[declaration.method]; // constructor method

            for (var j = 0; j < list.length; j++) {
                var def = list[j];
                method.call(self, def); // instantiates and maps blueprint items of current declaration type
            }

        }

    };

    MapItem.prototype._determineAlloys = function(){

        var cog = this.parent;
        var alloys = [];

        while (cog && cog.isAlloy){
            alloys.unshift(cog);
            cog = cog.parent;
        }

        this.alloys = alloys;

    };

    MapItem.prototype._exposeAlloys = function(){

        var scriptData = this.scriptData;
        var alloys =  this.alloys;
        for(var i = 0; i < alloys.length; i++){
            var alloy = alloys[i];
            var alloyName = alloy.name;
            if(alloyName){
                if(scriptData.hasOwnProperty(alloyName))
                    this.throwError("Alloy name is property already defined: " + alloyName);
                scriptData[alloyName] = alloy.scriptData;
            }

        }

    };


    MapItem.prototype._cogBuildDeclarations = function(){

        var self = this;
        var defs = self._declarationDefs;

        if(defs)
            self._cogFirstBuildDeclarations(defs);


        self.scriptData.init();


        if(defs) {

            defs.sensors.forEach(function (def) {
                self._createSensorFromDef3(def);
            });

            defs.writes.forEach(function (def) {
                self.createWrite(def);
            });
            defs.cogs.forEach(function (def) {
                self.createCog(def);
            });
            defs.chains.forEach(function (def) {
                self.createChain(def);
            });
        }


        self.scriptData.start();

        self._declarationDefs = null;

    };


    MapItem.prototype.createLink = function(url, name, data, index, key){

        var self = this;
        var mi = new MapItem();

        mi.cogZone = self.cogZone.demandChild();
        mi.aliasZone = self.aliasZone.demandChild();
        mi.url = url;
        mi.itemData = data;
        mi.itemKey = key;
        mi.itemOrder = index;
        mi.parent = self;
        mi.scriptData.mapItem = mi;
        self.childMap[mi.uid] = mi;

        mi.placeholder = $('<div style="display: none;"></div>');
        self.targetSel.append(mi.placeholder);

        if(self.itemType === DATA) {
            mi.createData({name: name, value: data});
        }

        mi._cogDownloadUrl(mi.url);
        return mi;

    };


    MapItem.prototype.appendCog= function(def, config){

        def.action = 'append';
        this.createCog(def,undefined,config);

    };

    MapItem.prototype.createCog = function(def, placeholder, config){

        var self = this;
        var mi = new MapItem();

        mi.cogZone = def.isRoute ? self.cogZone.demandChild(def.name, def.isRoute) : self.cogZone.demandChild();
        mi.aliasZone = self.aliasZone.demandChild();

        mi.config = copyProps(config, {});
        mi.target = def.target;
        mi.action = def.action || 'append';
        mi.source = def.source;
        mi.sourceType = def.sourceType || 'prop';
        mi.item = def.item;
        mi.itemType = def.itemType || 'config';
        mi.name = def.name;
        mi.url =  def.url;
        mi.urlType = def.urlType || 'string'; // s = string, c = config, d = data, p = prop

        mi.path = (def.path) ? self._resolvePath(def.path) : null;
        mi.parent = self;
        mi.scriptData.mapItem = mi;
        self.childMap[mi.uid] = mi;


        if(mi.urlType !== 'data') {

            mi.url = this._resolveValueFromType(mi.url, mi.urlType);
            if(!placeholder) {
                mi.placeholder = $('<div style="display: none;"></div>');
                mi.targetSel = (mi.target) ? self.scriptData[mi.target] : self.localSel.last();
                mi.targetSel[mi.action](mi.placeholder);
            } else {
                mi.placeholder = placeholder;
            }
            mi._cogDownloadUrl(mi.url);

        } else {

            mi.isPinion = true;
            mi._requirementsLoaded = true;
            mi.targetSel = (mi.target) ? self.scriptData[mi.target] : self.localSel.last();
            mi.urlFromPlace = mi.findData(mi.url).on('update').change().as(mi).host(mi.uid).run(mi._cogControlUrl).autorun();

        }

        return mi;

    };


    MapItem.prototype.createChain = function(def){

        var self = this;
        var mi = new MapItem();

        mi.cogZone = self.cogZone.demandChild();
        mi.aliasZone = self.aliasZone.demandChild();
        mi.isChain = true;
        mi.build = def.build;
        mi.order = def.order;
        mi.depth = def.depth;
        mi.source = def.source;
        mi.sourceType = def.sourceType;
        mi.item = def.item;
        mi.itemType = def.itemType;
        mi.target = def.target;
        mi.name = def.name;
        mi.listKey = def.key;
        mi.url =  def.url;
        mi.path = (def.path) ? self._resolvePath(def.path) : null;
        mi.parent = self;
        mi.scriptData.mapItem = mi;
        self.childMap[mi.uid] = mi;


        mi.targetSel = self.scriptData[mi.target];

        var resolvedUrl = this._resolveUrl(def.url, def.path);
        var urlPlace = bus.location("n-url:"+resolvedUrl);
        tryToDownload(resolvedUrl);
        urlPlace.on("done").as(mi).host(mi.uid).run(mi._seekListSource).once().autorun();
        return mi;

    };


// todo this is called an Alloy now
    MapItem.prototype.createAlloy = function(def) {

        // url must be cached/loaded at this point
        var self = this;

        if(self.destroyed)
            return;

        var shaft = new MapItem();


        //todo remove alias zones?
        //shaft.cogZone = self.cogZone.demandChild();
        shaft.cogZone = def.isRoute ? self.cogZone.demandChild(def.name, def.isRoute) : self.cogZone.demandChild();

        shaft.aliasZone = self.aliasZone.demandChild();

        shaft.origin = self; // cog that hosts this alloy
        //shaft.library = url;
        shaft.isAlloy = true;
        shaft.name = def.name;
        shaft.isRoute = def.isRoute;

        // insert shaft between this cog and its parent
        shaft.parent = self.parent;
        shaft.parent.childMap[shaft.uid] = shaft;
        delete self.parent.childMap[self.uid];
        self.parent = shaft;
        shaft.childMap[self.uid] = self;

        self.cogZone.insertParent(shaft.cogZone);


        shaft._cogAssignUrl(def.url);
        shaft._cogBecomeUrl();

    };

    MapItem.prototype.assignParent = function(newParent) {

        var self = this;

        var oldParent = self.parent;
        if(oldParent)
            delete oldParent.childMap[self.uid];
        self.parent = newParent;
        newParent.childMap[self.uid] = self;

    };

    MapItem.prototype._resolveSource = function() {

        if(this.isChain)
            this._chainResolveSource();
        else
            this._cogResolveSource();

    };

    MapItem.prototype._chainResolveSource = function() {

        this.sourceVal = this.parent._resolveValueFromType(this.source, this.sourceType);

        if (this.sourceType === DATA) {

            if (!this.sourceVal) {
                this.throwError('data source: ' + this.source + ' could not be resolved!');
                return;
            }

            this.sourceVal.on('update').as(this).host(this.uid).run(this._refreshListItems).autorun();

        } else {

            if(this.sourceVal === undefined){
                this.throwError('data source: ' + this.source + ' could not be resolved with static type!');
                return;
            }
            this._refreshListItems(this.sourceVal);

        }

    };

    MapItem.prototype._cogResolveSource = function() {

        if(!this.parent)
            return;

        this.sourceVal = this.parent._resolveValueFromType(this.source, this.sourceType);
        this.itemVal = this._resolveValueFromType(this.item, this.itemType, true);

        if(this.itemType === DATA)
            this.itemVal = this.demandData(this.item);

        if (this.sourceType === DATA) {

            if (!this.sourceVal) {
                this.throwError('data source: ' + source + ' could not be resolved!');
                return;
            }

            if(this.itemType === DATA) {
                this.itemVal = this.demandData(this.item);
                this.sourceVal.on('update').as(this).host(this.uid).pipe(this.itemVal).autorun();

                if(typeof this.scriptData.update === 'function')
                    this.itemVal.on('update').as(this).host(this.uid).run(this.scriptData.update).autorun();
            } else {
                var d = this.sourceVal.read();
                if(this.itemType === CONFIG)
                    this.createConfig(this.item, d);
                else if(this.itemType === PROP)
                    this.scriptData[this.item] = d; // todo add error check for prop collision
                else
                    this.throwError('invalid itemType: ' + this.itemType);
            }


        } else {

            if(this.itemType === DATA)
                this.itemVal.write(this.sourceVal);
            else
                this.throwError('invalid itemType: ' + this.itemType);
        }

    };


    MapItem.prototype._seekListSource = function(){

        if(this.source){
            this._resolveSource();
        } else {
            this.throwError('chain has no list source defined!');
        }

    };

    MapItem.prototype._generateKeyMapForListDisplay = function(){
        var keyMap = {};

        $.each(this.childMap, function(i, mi){
            var itemKey = mi.itemKey;
            keyMap[itemKey] = mi;
        });
        return keyMap;
    };




    MapItem.prototype._refreshListItems = function(arr){

        var url = this.url;
        var listKey = this.listKey;

        var i;

        //if(this.build === 'scratch')
        //    destroyInnerMapItems(this);

        var remnantKeyMap = this._generateKeyMapForListDisplay();
        var dataKeyMap = {};
        var listItem;

        var exiting = [];
        var updating = [];
        var entering = [];
        var resulting;

        var listItems = [];

        var itemDataName = this.item;

        for(i = 0; i < arr.length; ++i){ // loop through new set of data

            var d = arr[i];
            var itemKey = (listKey) ? d[listKey] : i; // use index if key not defined
            listItem = remnantKeyMap[itemKey]; // grab existing item if key used before

            if(listItem) { // already exists
                updating.push(listItem);
                if(this.source) {
                    var existingData = listItem.findData(itemDataName);
                    existingData.write(d);
                }
            } else {
                listItem = this.createLink(url, itemDataName, d, i, itemKey);
                entering.push(listItem);
            }


            var isOdd = !!(i & 1);
            listItem.localSel.toggleClass('odd',isOdd);

            dataKeyMap[itemKey] = listItem;

            listItems.push(listItem);

        }

        $.each(remnantKeyMap, function(oldKey, listItem){
            if(!dataKeyMap[oldKey])
                exiting.push(listItem);
        });

        resulting = [].concat(updating).concat(entering);

        this._appendList(entering, resulting, exiting);

    };


    MapItem.prototype._appendList = function(entering, resulting, exiting){

        $.each(entering, function(i, listItem){
            listItem.scriptData.enter.call(listItem.scriptData);
        });

        $.each(resulting, function(i, listItem){
            listItem.scriptData.update.call(listItem.scriptData);
        });

        $.each(exiting, function(i, listItem){
            listItem.scriptData.exit.call(listItem.scriptData);
        });


    };


    MapItem.prototype._cogBecomeUrl = function(){

        var mi = this;

        var url = mi.resolvedUrl;
        var htmlSel = cacheMap[url];

        mi._declarationDefs = declarationMap[url];

        if(mi.isAlloy)
            mi._cogInitialize();
        else {
            mi.localSel =  htmlSel.clone();
            mi._cogRequestRequirements();
        }

    };



    MapItem.prototype._cogControlUrl = function(url){

        var mi = this;
        mi.clearContent();

        if(!url)
            return;

        var def = {
            url: url
        };

        var placeholder = $('<div style="display: none;"></div>');
        mi.targetSel.append(placeholder);
        mi.createCog(def, placeholder);

    };


    MapItem.prototype._cogRequestRequirements = function(){

        var self = this;

        var libs = self._declarationDefs.requires;
        libs.forEach(function (def) {
            def.resolvedUrl = self._resolveUrl(def.url, def.path);
            self._cogAddRequirement(def.resolvedUrl, def.preload, def.name, def.isRoute);
        });

        if(self.requirements.length == 0) {
            self._cogInitialize();
        } else {
            self._cogDownloadRequirements();
        }

    };


    MapItem.prototype._cogInitialize = function(){

        var mi = this;
        if(mi.destroyed || !mi.parent || mi.parent.destroyed) return;

        var url = mi.resolvedUrl;
        var script = scriptMap[url] || defaultScriptDataPrototype;

        //console.log("INIT:" + mi.uid + ":" + mi.resolvedUrl);

        mi.scriptData = Object.create(script);
        mi.scriptData.mapItem = mi;

        if(!mi.isAlloy) {
            mi._generateDomIds();
            mi._determineAlloys();
            mi._exposeAlloys();
        }

        mi._requirementsLoaded = true;

        if(mi.placeholder){
            mi.placeholder.after(mi.localSel);
            mi.placeholder.remove();
            mi.placeholder = null;
        }

        if(mi.source)
            mi._resolveSource();

        mi._cogBuildDeclarations();

    };


    MapItem.prototype._generateDomIds = function(){
        var scriptData = this.scriptData;
        var ids = scriptData._ids;
        if(!ids || !ids.length) return;
        var sel = this.localSel;
        for(var i = 0; i < ids.length; i++){
            var id = ids[i];
            var el = sel.find("#"+id);
            if(!el.length)
                el = sel.filter('#'+id);

            if(!el.data("preserveId"))
                el.attr("id",this.uid+"_"+id);
            // TODO this camel stuff looks dumb, please fix or remove it
            var camelId = id.replace(/-([a-z])/g, function (g) { return g[1].toUpperCase(); });
            scriptData[camelId] = el;

        }

    };

    MapItem.prototype._cogRequirementReady = function(urlReady) {

        //console.log('just got:' + urlReady);

        var req, i, j;
        var self = this;
        var allReady = true; // assertion to disprove
        var match = -1;
        var newReqs = [];
        var newReq;

        for(i = 0; i < self.requirements.length; i++) {
            req = self.requirements[i];
            if(req.url === urlReady && !req.ready) {
                match = i;
                req.ready = true;
                if(endsWith(urlReady,".html")){
                    var libs = declarationMap[urlReady].requires;
                    for(j = 0; j < libs.length; j++){
                        var def = libs[j];
                        def.path = def.path || determinePathFromFullUrl(urlReady);
                        var resolvedURL = self._resolveUrl(def.url, def.path);
                        if(self.requirementsSeen[resolvedURL])
                            continue;
                        newReq = createRequirement(resolvedURL, def.preload, urlReady, def.name, def.isRoute);
                        newReqs.push(newReq);
                        self.requirementsSeen[resolvedURL] = newReq;
                    }
                    if(newReqs.length > 0)
                        allReady = false;

                }
            }
            allReady = allReady && req.ready;
        }


        for(i = 0; i < newReqs.length; i++){
            newReq = newReqs[i];
            self.requirements.splice(match, 0, newReq); // put new requirements after last match
        }

        for(i = 0; i < newReqs.length; i++){
            newReq = newReqs[i];
            tryToDownload(newReq.url);
            newReq.place.on("done").as(self).host(self.uid).run(self._cogRequirementReady).once().autorun();
        }

        if(self._requirementsLoaded) {
            console.log('ready called but loaded set?');
            return;
        }

        if(!allReady)
            return;

        for(i = 0; i < self.requirements.length; i++){
            req = self.requirements[i];
            var url = req.url;

            if(endsWith(url,".js")) {
                if(!libraryMap[url]) { // limits script execution to once per url
                    libraryMap[url] = url;
                    var scriptText = req.place.read();
                    scriptText = wrapScript(scriptText, url);
                    addScriptElement(scriptText);
                }
            } else if(endsWith(url,".html")) {
                if(!req.preload)
                    self.createAlloy(req);
            }
        }

        // check that new requirements are downloaded -- todo optimize all this
        for(i = 0; i < self.requirements.length; i++){
            req = self.requirements[i];
            var status = req.place.peek("status");
            if(!status || !status.msg || !status.msg.done) {
                return; // requirements remain...
            }
        }

        self._cogInitialize();

    };




    function createRequirement(requirementUrl, preload, fromUrl, name, isRoute){
        var urlPlace = bus.location("n-url:"+requirementUrl);
        return {url: requirementUrl, fromUrl: fromUrl, place: urlPlace, preload: preload, name: name, isRoute: isRoute};
    }

    MapItem.prototype._cogAddRequirement = function(requirementUrl, preload, name, isRoute) {

        //console.log('add: '+ requirementUrl);
        var self = this;
        var urlPlace = bus.location("n-url:"+requirementUrl);
        var requirement = {url: requirementUrl, fromUrl: self.resolvedUrl, place: urlPlace, preload: preload, name: name, isRoute: isRoute};

        self.requirements.push(requirement);
        self.requirementsSeen[requirement.url] = requirement;

    };

    MapItem.prototype._cogDownloadRequirements = function() {

        var self = this;
        for(var i = 0; i < self.requirements.length; i++){
            var r = self.requirements[i];
            //console.log('try: '+ r.url);
            tryToDownload(r.url);
            r.place.on("done").as(self).host(self.uid).run(self._cogRequirementReady).once().autorun();
        }

    };



    function tryToDownload(url) {


        var urlPlace = bus.location("n-url:"+url);
        var status = urlPlace.peek("status");

        if(status && (status.msg.active || status.msg.done))
            return; // already downloading or successfully downloaded

        if(!status) {
            urlPlace.write({active: true, errors: 0}, "status");
        } else {
            var newStatus = {active: true, fail: false, errors: status.msg.errors};
            urlPlace.write(newStatus, "status");
        }

        var isHTML = endsWith(url, ".html");
        var suffix = "?buildNum=" + buildNum;

        //console.log("GO DOWNLOAD: " + url);

        $.ajax({url: url + suffix, dataType: "text"})
            .done(function(response, status, xhr ){

               //console.log('got file:'+url);
               urlPlace.write(response);

               if (isHTML)
                    parseResponseHTML(response, url);

                urlPlace.write({active: false, done: true}, "status");
                urlPlace.write(url, "done");


            })
            .fail(function(x,y,z){

                var status = urlPlace.peek("status");
                var newStatus = {active: false, fail: true, errors: status.msg.errors + 1};
                urlPlace.write(newStatus, "status");

            });
    }

    function endsWith(entireStr, ending){
        return (entireStr.lastIndexOf(ending) === (entireStr.length - ending.length) && entireStr.length > ending.length);
    }

    function parseResponseHTML(response, url) {


        activeProcessURL = url;

        var responseSel = $(response);
        var blueSel = responseSel.filter("blueprint");
        var scriptSel = responseSel.filter("script");
        var htmlSel = responseSel.filter("display").children().clone();

        htmlSel.prevObject = null; // note: avoids terrible jquery bug, holding scary DOM references

        var scriptText;
        if(scriptSel.length > 0)
            scriptText = scriptSel[0].innerHTML;

        if(scriptText) {
            scriptText = wrapScript(scriptText, url);
            try {
                addScriptElement(scriptText);
            } catch(err) {
                console.log(err);
            }
        } else {
            activeScriptData = activeScriptData || Object.create(defaultScriptDataPrototype);
        }

        if(!activeScriptData)
            throw new Error("Script Data Failure:" + url);

        if(htmlSel.length > 0)
            cacheMap[url] = htmlSel.clone();
        declarationMap[url] = extractDeclarations(blueSel);

        scriptMap[url] = activeScriptData;

        parseElementIds(htmlSel, activeScriptData);

        activeScriptData = null;

    }

    function throwParseError(sel, dataType, propName){
        console.log("PARSE ERROR:"+dataType+":"+propName+":"+activeProcessURL);
    }

    function parseElementIds(sel, scriptData){
        // TODO store these in the mapitem function def creator later
        // when map items runs as function list not parse build
        var idSels = sel.find("[id]").add(sel.filter('[id]'));
        var ids = idSels.map(function() { return this.id; }).get();
        scriptData._ids = ids;
    }

    function wrapScript(scriptText, url) {

        var website = 'http://cognition';//http://www.cognition.com/';
        var wrapped =
                scriptText + "\n//# sourceURL=" + website + url + "";
        return wrapped;
    }

    function addScriptElement(scriptText) {

        var scriptEle = document.createElement("script");
        scriptEle.type = "text/javascript";
        scriptEle.text = scriptText;
        // todo add window.onerror global debug system for syntax errors in injected scripts
        document.head.appendChild(scriptEle); // runs ndash.use(some_object) if html based;

        scriptEle.parentNode.removeChild(scriptEle);

    }

    MapItem.prototype._cogAssignUrl = function(url) {
        var self = this;
        self.url = url;
        var resolvedUrl = self.resolvedUrl = self._resolveUrl(url);
        self.path = self._determinePathFromFullUrl(resolvedUrl);
    };

    MapItem.prototype._cogDownloadUrl = function (url) {

        var self = this;
        self._cogAssignUrl(url);
        var urlPlace = bus.location("n-url:"+ self.resolvedUrl);
        tryToDownload(self.resolvedUrl);
        urlPlace.on("done").as(self).host(self.uid).run(self._cogBecomeUrl).once().autorun();

    };

    MapItem.prototype.clearContent = function(){
        destroyInnerMapItems(this);
        if(this.localSel)
            this.localSel.empty();
    };


    MapItem.prototype._resolvePath = function(path){

        if(path)
            path = this.findAlias(path) || path;
        else
            path = this._findPath();

        path = (path) ? this._endWithSlash(path) : "/";
        return path;

    };

    MapItem.prototype._resolveUrl = function(url, path){

        var from = this;
        url = from.findAlias(url) || url;
        path = from._resolvePath(path);
        var raw = (url.indexOf("/")===0 || url.indexOf("http://")===0 || url.indexOf("https://")===0);
        var full =  (path && !raw) ? path + url : url;
        if(full.indexOf("..")===-1)
            return full;
        return from._collapseRelativePath(full);
    };

    MapItem.prototype._collapseRelativePath = function(url){

        var parts = url.split("/");
        var remnants = [];

        while(parts.length > 0) {
            var chunk = parts.shift();
            if(chunk !== ".."){
                remnants.push(chunk);
            } else if(remnants.length > 0) {
                remnants.pop();
            }
        }
        return remnants.join("/");

    };

    MapItem.prototype._endWithSlash = function(str) {
        var lastChar = str.charAt(str.length-1);
        if(lastChar === "/") return str;
        return str + "/";
    };

    MapItem.prototype._findPath = function(){
        var item = this;
        do{
            if(item.path)// && !item.library)
                return item.path;
            item = item.parent;
        } while(item);
        return undefined;
    };


    MapItem.prototype.find = function(name, thing, where, optional){

        thing = thing || 'data';
        where = where || 'first';

        var mapNames = {
            data: 'dataMap',
            feed: 'feedMap',
            service: 'serviceMap',
            config: 'config',
            alias: 'aliasMap',
            method: 'methodMap'
        };

        var map = mapNames[thing];
        return this._find(name, map, where, optional);
    };


    MapItem.prototype.createAlias = function(def){
        //var this.aliasZone =
        return this.aliasMap[def.name] = this._resolveUrl(def.url, def.path);
    };

    MapItem.prototype.createValve = function(def){

        var valveMap = this.valveMap = this.valveMap || {dataMap: null, aliasMap: null, config: null}; // todo switch config to configMap
        var thingKey = def.thing + 'Map';
        var accessHash = valveMap[thingKey] = valveMap[thingKey] || {};
        for(var i = 0; i < def.allow.length; i++){
            var allowKey = def.allow[i];
            accessHash[allowKey] = true;
        }
        return accessHash;

    };


    MapItem.prototype.createWrite = function(def){
        var mi = this;
        var dataPlace = mi.find(def.name, def.thing, def.where);
        if(!dataPlace)
            mi.throwError("Could not write to: " + def.name + ":" + def.thing + ":" + def.where);
        dataPlace.write(def.value);
    };


    MapItem.prototype.createFeed = function(def){

        var mi = this;
        var feed = new Feed();
        feed.init(def, mi);

        return feed;

    };


    MapItem.prototype.createService = function(def){

        var mi = this;
        var service = new Service();
        service.init(def, mi);

        return service;

    };

    MapItem.prototype.createSensor = function(watch, thing, topic, where){
        thing = thing || 'data';
        topic = topic || 'update';
        where = where || 'first';
        var def = {
            watch: [watch],
            thing: thing,
            topic: topic,
            where: where
        };
        return this._createSensorFromDef3(def);
    };

    MapItem.prototype._senseInteraction = function(nodeId, eventName){
        var self = this;
        var sel = this.scriptData[nodeId];
        if (!sel) {
            self.throwError("Could not detect interaction, missing sel id: " + nodeId);
            return;
        }

        return sel.detect(eventName);

    };


    MapItem.prototype._createSensorFromDef3 = function(def){

        var mi = this;
        var dataPlace;
        var pipePlace;
        var sensor;
        var actualPlaceNames = [];



        if(def.find){

            var eventName = def.detect || def.topic;
            var nodeId = def.find;
            sensor = mi._senseInteraction(nodeId, eventName);

        } else {

            // todo can rm this? -- checks for data good
            //
            //for (var i = 0; i < def.watch.length; i++) {
            //    dataPlace = mi.find(def.watch[i], def.thing, def.where);
            //    if (!def.optional && !dataPlace) {
            //        mi.throwError("Could not build sensor: " + def.thing + ":" + def.watch[i] + ":" + def.where + " in " + mi.resolvedUrl);
            //        return;
            //    }
            //    if (dataPlace)
            //        actualPlaceNames.push(dataPlace._name);
            //}

            // todo make multiloc upfront and don't search names again
            //if (actualPlaceNames.length === 0)
            //    return null; // optional places not found

            dataPlace = mi.cogZone.findData(def.watch, def.where, def.optional);

            if(!dataPlace && def.optional)
                return null;

            sensor = dataPlace.on(def.topic);
            //sensor = bus.location(actualPlaceNames).on(def.topic);
        }

        var context = mi.scriptData;

        sensor
            .as(context)
            .host(mi.uid);

        if(def.extract){
            sensor.extract(def.extract);
        }

        if(def.adaptPresent){
            sensor.adapt(this._resolveValueFromType(def.adapt, def.adaptType))
        }

        if(def.change)
            sensor.change(def.change);

        if (def.filter) {
            var filterMethod = context[def.filter];
            sensor.filter(filterMethod);
        }

        var multiSensor = null;
        if(def.watch.length > 1) {

                multiSensor = sensor; // add source (multi to source) and grab() -- grab all data upstream in a merged
                sensor = sensor.merge().on(def.topic).batch();

        } else if(def.batch) {
            sensor.batch();
        }


        if(def.transformPresent){
            sensor.transform(this._resolveValueFromType(def.transform, def.transformType))
        }

        if(def.emitPresent){
            sensor.emit(this._resolveValueFromType(def.emit, def.emitType))
        }

        if(def.retain)
            sensor.retain();

        if(def.group && multiSensor) {
            multiSensor.batch();
            sensor.group();
        }

        if(def.keep){
            if(multiSensor)
                multiSensor.keep(def.keep);
            else
                sensor.keep(def.keep);
        }

        if(def.need && def.need.length > 0)
            sensor.need(def.need);

        if(def.gather && def.gather.length > 0)
            sensor.gather(def.gather);

        if(def.demand){
            pipePlace = mi.demandData(def.demand); // todo move all this creation of data point into defs so creation order is same
            mi.scriptData[def.demand] = pipePlace; // todo replace with exposeProp and check for existence, throw errors
            sensor.pipe(pipePlace);
        }
        else if(def.pipe) {
            pipePlace = mi._find(def.pipe, 'dataMap', def.pipeWhere);
            sensor.pipe(pipePlace);
        }

        if(def.run && !def.demand && !def.pipe) {
            var callback = context[def.run];
            sensor.run(callback);
        }

        if(def.once)
            sensor.once();

        if(def.defer)
            sensor.defer();

        if(multiSensor)
            multiSensor.autorun();

        if(def.autorun){
            sensor.autorun();
        }

        return sensor;

    };




    MapItem.prototype.exposeProp = function(name, value){
        var mi = this;
        if(mi.scriptData[name])
            mi.throwError("Prop already defined: "+ name);
        mi.scriptData[name] = value;
    };


    MapItem.prototype.createProp = function(def){

        var mi = this;
        var prop = mi.find(def.find, def.thing, def.where, def.optional);

        if(!prop && def.optional)
            return;

        if(prop === undefined && def.thing !== 'config') // todo force optional flag use for config too
            mi.throwError("Could not build Prop: " + def.find + ":" + def.thing + ":" + def.where);

        if(mi.scriptData[def.name])
            mi.throwError("Prop already defined: "+ def.name);

        mi.scriptData[def.name] = prop;

        return prop;

    };

    MapItem.prototype.throwError = function(msg){
        throw new Error("MapItem: " + this.resolvedUrl + ": id: " + this.uid + ": " + msg);
    };

    MapItem.prototype.findMethod = function(name, where){
            return this._find(name, 'methodMap', where);
    };


    //MapItem.prototype._find2 = function(name, map, where) {
    //
    //    if(map !== 'dataMap')
    //        return this._find(name, map, where);
    //
    //    return this.cogZone.findData(name, where);
    //};

    MapItem.prototype._find = function(name, map, where, optional) {


        if(map === 'dataMap')
            return this.cogZone.findData(name, where, optional);

        where = where || FIRST; // options: local, first, outer, last

        if(where === LOCAL)
            return this._findLocal(name, map);
        else if(where === FIRST)
            return this._findFirst(name, map);
        else if(where === OUTER)
            return this._findOuter(name, map);
        else if(where === LAST)
            return this._findLast(name, map);
        else if(where === PARENT)
            return this._findFromParent(name, map);
        else
            throw new Error('Invalid option for [where]: ' + where);
    };

    MapItem.prototype._findLocal = function(name, map) {
        return this[map][name];
    };

    MapItem.prototype._findFirst = function(name, map, fromParent) {

        var item = this;
        var checkValve = fromParent;

        do {

            if(checkValve && item.valveMap && item.valveMap[map] && !item.valveMap[map].hasOwnProperty(name))
                return undefined; // not white-listed by a valve on the cog

            checkValve = true; // not checked at the local level (valves are on the bottom of cogs)

            var result = item[map][name];
            if (item[map].hasOwnProperty(name))
                return result;

        } while (item = item.parent);

        return undefined;
    };

    MapItem.prototype._findFromParent = function(name, map) {
        var p = this.parent;
        if(!p) return undefined;
        return p._findFirst(name, map, true);
    };

    MapItem.prototype._findOuter = function(name, map) {

        var item = this;
        var found = false;
        var checkValve = false;

        do {

            if(checkValve && item.valveMap && item.valveMap[map] && !item.valveMap[map].hasOwnProperty(name))
                return undefined; // not white-listed by a valve on the cog

            checkValve = true; // not checked at the local level (valves are on the bottom of cogs)


            var result = item[map][name];
            if (item[map].hasOwnProperty(name)) {
                if (found)
                    return result;
                found = true;
            }
        } while (item = item.parent);

        return undefined;

    };

    MapItem.prototype._findLast = function(name, map) {

        var item = this;
        var result = undefined;
        var checkValve = false;

        do {

            if(checkValve && item.valveMap && item.valveMap[map] && !item.valveMap[map].hasOwnProperty(name))
                return result; // not white-listed by a valve on the cog

            checkValve = true; // not checked at the local level (valves are on the bottom of cogs)

            if (item[map].hasOwnProperty(name))
                result = item[map][name];
        } while (item = item.parent);

        return result;

    };

    MapItem.prototype.createMethod = function(def){

        var mi = this;
        var method = mi.scriptData[def.func];

        if((typeof method) !== 'function'){
            mi.throwError("Method must be a function: " + def.func);
        }

        method.originalContext = mi.scriptData;

        if(def.bound)
            method = method.bind(method.originalContext);

        return this.methodMap[def.name] = method;

    };

    MapItem.prototype.findService = function(name, where){
        return this._find(name, 'serviceMap', where);
    };

    MapItem.prototype.findFeed = function(name, where){
        return this._find(name, 'feedMap', where);
    };

    MapItem.prototype.findData = function(name, where, optional){
        return this._find(name, 'dataMap', where, optional);
    };

    MapItem.prototype.findConfig = function(name, where){
        return this._find(name, 'config', where);
    };

    MapItem.prototype.findAlias = function(name, where){
        return this._find(name, 'aliasMap', where);
    };

    MapItem.prototype.demandData = function(name){
        return this.cogZone.demandData(name);
        //return this.findData(name, LOCAL) || this.createData({name: name});
    };

    MapItem.prototype.createConfig = function(name, value){
        this.config[name] = value;
    };


    MapItem.prototype.createConfig2 = function(def){

        var self = this;
        var name = def.name;
        if(name.indexOf(":")!=-1)
            self.throwError("Invalid config name: " + name);

        var value = def.value;
        var type = def.valueType;
        var inherited = false;

        if (def.inherit) {
            value = self._find(name, 'config', 'first');
            inherited = true;
        }

        if (!inherited || value === undefined)
            value = this._resolveValueFromType(value, type);

        if(def.prop){
            if(self.scriptData[def.name])
                self.throwError("Property already defined: " + def.name);
            self.scriptData[def.name] = value;
        }

        this.config[name] = value; // todo become configMap

        return value;
    };

    MapItem.prototype._resolveValueFromType = function(value, type, demandIt){

        if(!type)
            return value; // assume it is what it is...

        if(type === STRING)
            return value;

        if(type === NUMBER)
            return Number(value);

        if(type === BOOLEAN)
            return (value === true || value === 'true');

        if(type === OBJECT)
            return (typeof value === 'object') ? value : null;

        if(type === CONFIG)
            return this.findConfig(value); // todo add error if not found?

        if(type === DATA)
            return (demandIt) ? this.demandData(value) : this.findData(value);

        if(type === READ) {
            var d = this.findData(value);
            return function() {
                return d.read(); // todo  add error handling?
            }
        }

        if(type === FEED)
            return this.findFeed(value);

        if(type === SERVICE)
            return this.findService(value);

        var context = this.scriptData;
        if(type === PROP)
            return context[value];

        if(type === RUN)
            return this._resolveRunValue(value, context);

    };

    MapItem.prototype._resolveRunValue = function(value, context){

        var f = context[value];
        if(f && typeof f === 'function'){
            return f.call(context);
        } else {
            var method = this.findMethod(value);
            if (typeof method !== 'function') {
                this.throwError('run method not found!');
                return;
            }
            return method.call(context);
        }
    };

    MapItem.prototype.createData = function(def){

        var self = this;
        var name = def.name;

        //TODO strip colons in user input, so framework can use them as reserved creations
        //if(name.indexOf(":")!=-1)
        //    self.throwError("Invalid data name: " + name);

        var value = def.value;
        var type = def.valueType;
        var inherited = false;


        if (def.inherit) {
            var ancestor = self._find(name, 'dataMap', 'first', true);
            if(ancestor && ancestor.peek()) {
                value = ancestor.read();
                inherited = true;
            }
        }

        if (!inherited)
            value = this._resolveValueFromType(value, type);

        var data = self.cogZone.demandData(name);
        //var data = self.dataMap[name] = bus.location("n-data:"+self.uid+":"+name);

        if(def.prop){
            if(self.scriptData[def.name])
                self.throwError("Property already defined: " + def.name);
            self.scriptData[def.name] = data;
        }

        if(def.name){
            data.tag(def.name);
        }

        if(def.adaptPresent){
            data.adapt(this._resolveValueFromType(def.adapt, def.adaptType))
        }

        if(def.isRoute){
            data.route();
        }


        data.initialize(value);

        if(def.servicePresent || def.url) {

            var settings = def.servicePresent ? this._resolveValueFromType(def.service, def.serviceType) : {};

            settings.url = def.url || settings.url;
            settings.path = def.path || settings.path;
            settings.verb = def.verb || settings.verb || 'GET'; // || global default verb
            settings.params = settings.params || {};


            if(def.paramsPresent) {
                var params = this._resolveValueFromType(def.params, def.paramsType) || {};
                copyProps(params, settings.params);
            }

            var service = new WebService();
            service.init(settings, self, data);
            self.webServiceMap[data._id] = service;
            if(def.request)
                service.request();

        }

        return data;

    };

    // Arguments :
    //  verb : 'GET'|'POST'
    //  target : an optional opening target (a name, or "_blank"), defaults to "_self"
    MapItem.prototype.postToBlankWindow = function(url, data) {

            var form = document.createElement("form");
            form.action = url;
            form.method = 'POST';
            form.target = '_blank';

            if (data) {
                for (var key in data) {
                    var input = document.createElement("textarea");
                    input.name = key;
                    input.value = typeof data[key] === "object" ? JSON.stringify(data[key]) : data[key];
                    form.appendChild(input);
                }
            }

            form.style.display = 'none';
            document.body.appendChild(form);
            form.submit();
            form.parentNode.removeChild(form);

     };

    var Service = function(){

        this._mapItem = null;
        this._name = null;
        this._url = null;
        this._settings = null;
        this._defaultFeed = null;

    };

    Service.prototype.init = function(def, mi) {

        var service = mi.serviceMap[def.name] = this;

        service._mapItem = mi;
        service._name = name;

        var resolvedUrl = mi._resolveUrl(def.url, def.path);
        var settings = {};
        settings.type = (def.post) ? 'POST' : 'GET';
        settings.dataType = def.format;
        service.url(resolvedUrl).settings(settings);

        // create default feed
        var feedDef = extractDefaultFeedDefFromServiceDef(def);
        service._defaultFeed = mi.createFeed(feedDef);

        if(def.run)
            service.run(def.run);

        if(def.prop)
            mi.exposeProp(def.name, service);

        if(def.request)
            service.request();

        return service;

    };


    Service.prototype.name = function(){
        return this._name;
    };


    Service.prototype.url = function(url){
        if(arguments.length==0) return this._url;
        this._url = url;
        return this;
    };

    Service.prototype.settings = function(settings){
        if(arguments.length==0) return this._settings;
        this._settings = settings;
        return this;
    };

    Service.prototype.to = Service.prototype.data = function(dataPlace) {
        return this._defaultFeed.to(dataPlace);
    };

    Service.prototype.req = Service.prototype.request = function() {
        return this._defaultFeed.request();
    };

    Service.prototype.run = function(callbackName){
        console.log("NOT READY!!!!!");
    };

    Service.prototype.params = function(params) {
        return this._defaultFeed.params(params);
    };

    Service.prototype.parse = function(parseFunc) {
        return this._defaultFeed.parse(parseFunc);
    };

    var WebService = function() {

        this._cog = null;
        this._settings = {url: null, params: null, format: 'jsonp', verb: 'GET'};
        this._location = null;
        this._primed = false;
        this._xhr = null;
        this._timeoutId = null;

    };

    WebService.prototype.init = function(settings, cog, location){


        this._location = location;
        this._cog = cog;
        this.settings(settings);
        this._location.service(this);

        return this;

    };

    WebService.prototype.settings = function(settings) {

        if(arguments.length==0)
            return this._settings; // todo copy and freeze object to avoid outside mods?

        this.abort();

        var defaults = copyProps(webServiceDefaults, {});
        settings = copyProps(settings, defaults); // override defaults

        settings.resolvedUrl = this._cog._resolveUrl(settings.url, settings.path);
        this._settings = settings;

        return this;

    };

    WebService.prototype.abort = function() {

        if(this._primed) {
            clearTimeout(this._timeoutId);
            this._primed = false;
            this._timeoutId = null;
        }

        if(this.isActive()){
            this._xhr.abort();
            this._location.write(this._settings, 'abort');
        }

        return this;

    };

    WebService.prototype.isActive = function(){

        return self._xhr && self._xhr.readyState && self._xhr.readyState != 4;

    };


    WebService.prototype.params = function(params) {

        if(arguments.length==0)
            return this._settings.params; // todo copy and freeze objects to avoid outside mods?

        this.abort();

        this._settings.params = params;

        return this;
    };

    WebService.prototype.req = WebService.prototype.request = function(params){

        if(params)
            this.params(params);

        if(!this._primed){
            this._primed = true;
            this._timeoutId = setTimeout(this._runRequest.bind(this),0);
        }

        return this;

    };

    WebService.prototype._runRequest = function(){

        var self = this;
        self._primed = false;

        self.abort(); // this should not be needed, possible sanity check

        self._location.write(self._settings, 'request');

        var settings = {};

        settings.data = self._settings.params;
        settings.url = self._settings.resolvedUrl;
        settings.type = self._settings.verb || 'GET';
        settings.dataType = self._settings.format;

        self._xhr = $.ajax(settings)
            .done(function(response, status, xhr ){

                self._location.write(response);
                self._location.write(response, 'done');
                self._location.write(response, 'always');
                self._location.write(status, 'status');

            })
            .fail(function(xhr, status, error){

                self._location.write(error, 'error');
                self._location.write(error, 'always');
                self._location.write(status, 'status');

            })
        ;
        return self;
    };


    var Feed = function() {

        this._mapItem = null;
        this._name = null;
        this._service = null;
        this._feedPlace = null;
        this._dataPlace = null;
        this._params = null;
        this._primed = false;
        this._uid = ++uid;

    };

    Feed.prototype.init = function(def, mi){

        var feed = mi.feedMap[def.name] = this;
        var service = feed._service = mi.findService(def.service);

        var dataName = def.to || def.service;

        feed._mapItem = mi;
        feed._name = def.name;
        feed._feedPlace = bus.location("n-feed:" + mi.uid + ":"+ def.name);
        feed._dataPlace = mi.demandData(dataName);
        feed._params = null;
        feed._primed = false; // once a request is made, executed on next js frame to allow easy batching, avoid multiple calls

        if(def.prop) {
            mi.exposeProp(def.name, feed);
            if(dataName !== def.name)
                mi.exposeProp(dataName, feed._dataPlace);
        }

        if(def.request)
            feed.request();

    };

    Feed.prototype.on = function(name){
        return this._feedPlace.on(name);
    };

    // TODO feed cache with array and hashmap to make history size

    Feed.prototype.to = Feed.prototype.data = function(dataPlace){
        if(arguments.length==0) return this._dataPlace;
        // todo if changing target, fire feed.detach event
        if(!dataPlace && this._name){
            // TODO is this old format and broken???
            dataPlace = this.mapItem.createData(this._name); // create data named after the feed
        }

        if((typeof dataPlace) === 'string')
            dataPlace = this.mapItem.findData(dataPlace);

        if(!dataPlace){
            console.log("INVALID DATA pointed to by feed!");
            return null;
        }
        this._dataPlace = dataPlace;
        this._dataPlace.write(this,"attach");
        return this._dataPlace;
    };

    Feed.prototype.params = function(params){
        if(arguments.length==0) return this._params;
        this._params = params;
        //this._determineParamsKey();
        return this;
    };

    Feed.prototype.parse = function(parseFunc){
        // TODO if not typeof func, error
        this._parse = parseFunc;
        return this;
    };

    function createResponseInfo(){
        return {
            response: null,
            status: null,
            xhr: null,
            error: null,
            feed: null,
            parsed: null
        };
    }

    Feed.prototype.req = Feed.prototype.request = function(){
        if(!this._primed){
            this._primed = true;
            setTimeout(this._runRequest.bind(this),0);
        }
        return this;
    };

    Feed.prototype._runRequest = function(){

        var self = this;
        self._primed = false;

        // abort any prior running request using this feed object
        var running = self._xhr && self._xhr.readyState && self._xhr.readyState != 4;
        if(running) {
            self._xhr.abort();
        }

        var info = createResponseInfo();
        info.params = self._params;
        info.feed = self;

        self._feedPlace.write(info, "request");
        if(self._dataPlace)
            self._dataPlace.write(info, "request");

        var settings = self._service._settings;
        settings.data = self._params;
        settings.url = self._service._url;

        self._xhr = $.ajax(settings)
            .done(function(response, status, xhr ){
                info.response = response;
                info.parsed = (self._parse) ? self._parse(response) : response;
                info.status = status;
                info.xhr = xhr;
                info.error = null;

                self._feedPlace.write(info, "done");
                self._feedPlace.write(info, "always");
                if(self._dataPlace)
                    self._dataPlace.write(info.parsed);

            })
            .fail(function(xhr, status, error){
                info.response = null;
                info.status = status;
                info.xhr = xhr;
                info.error = error;
                self._feedPlace.write(info, "fail");
                self._feedPlace.write(info, "always");
                if(self._dataPlace)
                    self._dataPlace.write(info, "error");
            })
        ;
        return self;
    };




})(jQuery);
