
var Route = require('./Route.js');
var express = require('express');
var Emitter = require('./Emitter');

function sendError(err, res) {
    res.end(JSON.stringify({
        success: false,
        message: err
    }));
    console.error(err);
}


function error(res) {
    return function(err){
        sendError(err, res);
    };
}

function query(res, callback) {
    return function(err, item){
        if(err) sendError(err, res);
        else{
            callback(item);
        }
    }
}

function json(res, object) {
    var json = JSON.stringify(object);
    if(res) res.end(json);
    return json;
}


module.exports = function(schemas, router){
    var api = Emitter();
    var route, schema;

    api.router = router;
    api.schemas = schemas;
    api.routes = {};
    api.models = {};
    api.error = error;
    api.query = query;
    api.json = json;
    //api.before = function(event, listener){
    //    return api.on('before.' + event, listener);
    //};
    //api.after = function(event, listener){
    //    return api.on('after.' + event, listener);
    //};
    api.getAll = function(cb, user){  // just for development
        var collections = {};
        var count = 0;

        function fillCollection(name) {
            return function(collection){
                collections[name] = collection;
                count--;
                if(count === 0) cb(collections);
            };
        }

        for(var name in api.routes){       ///  fill all collections in memory - for development
            count++;
            api.routes[name].getAll(fillCollection(name), function(err){
                console.error(err);
            }, user);
        }
    };
    for(var name in schemas){
        route = Route(name, router, schemas[name], api);
        api.routes[name] = route;
        api.models[name] = route.model;
    }
    return api;
};