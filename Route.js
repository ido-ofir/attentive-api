var mongoose = require('mongoose');
require('mongoose-pager')(mongoose);
var Emitter = require('events').EventEmitter;
var Action = require('./Action.js');
/*
*
*   api Route module.
*   builds a rest api for provided schemas, which can be accessed by /api/[name].
 *  the module also produces an object for server side access which has the following methods:
 *
 *      create (item, success, fail) {}
 *      get (id, success, fail) {}
 *      update (item, success, fail) {} // item must have a valid id or _id
 *      delete (id, success, fail) {}
 *      getAll (success, fail) {}
 *      find (object, success, fail) {}
 *      filter (options, success, fail) {}
 *      pager (page, length, success, fail) {}
 *
 *      this object will also have a 'model' field which is the mongo model,
 *      and a 'schema' field - mongo schema, and a route method which takes an inner route and returns an express Router.route() instance
*
*       rest api:
*
*       /get              - get all
*
* */


var models = {};

function error(res, msg) {
    res.end(JSON.stringify({
        success: false,
        message: msg
    }));
    console.error(msg)
}

function query(success, fail) {
    return function(err, response){
        if(err) return fail(err);
        success(response);
    }
}




module.exports = function(name, router, schema, api){
    //console.log('defining route ', name);
    var route,
        model;

    if(models[name]){
        return console.error(name + ' route already exists');
    }

    function emit(target, eventName, event, next, fail) {
        var listened = target.emit(eventName, event, next, fail);
        if(!listened) next();
    }


    function run(eventName, data, action, success, fail, user) {          // emits 'before' events, then performs the action, then emits 'after' events, then calls 'success'
        if(!user) {
            //console.log(eventName, name, 'cannot find user');
            return fail('cannot find user in ' + name + '.' + eventName);
        }
                                                                         // all the listeners and db calls are called with the same event object. mutate event.data to control what the next listener will get
        var before = 'before.' + eventName;
        var after = 'after.' + eventName;                                // example - if event is 'create':
        var event = {data: data, model: model, name: name, user: user, action: eventName};  // the emitted event. event.data is whatever the user passed in
        var uuid = data.uuid;
        emit(api, before, event, function(){                             // emit 'before.create' on api
            emit(route, before, event, function(){                       // emit 'before.create' on route
                action(event, function(){                                // perform route's create action
                    if(uuid) event.data.uuid = uuid;                     // copy uuid for tracking optimistic updates in the client
                    emit(route, after, event, function(){                // emit 'after.create' on route
                        emit(api, after, event, function(){              // emit 'after.create' on api
                            success(event.data);                         // successfully finished. event.data is now the result of all listeners and the db call.
                        }, fail);
                    }, fail);
                });
            }, fail);
        }, fail);
    }

    schema = new mongoose.Schema(schema);
    model = models[name] = mongoose.model(name, schema);
    route = new Emitter();

    route.create = function(item, success, fail, user){
        if(!item) item = {};
        run('create', item, function(event, next){
            var newItem = new model(event.data);
            newItem.createDate = new Date();
            newItem.save(query(function(data){
                event.data = data;
                next();
            }, fail));
        }, success, fail, user);
    };

    route.get = function(id, success, fail, user){
        if(!id) return fail('id parameter is missing for route.get');
        run('get', id, function(event, next){
            model.findById(event.data, query(function(item){
                if(!item) return fail('cannot find ' + name + ' with id ' + id);
                event.data = item;
                next();
            }, fail));
        }, success, fail, user);
    };

    route.update = function(item, success, fail, user){
        if(!item) return fail('item is missing for route.update');
        var id = item._id;
        if(!id) return fail('item._id is missing for route.update');
        run('update', item, function(event, next){
            model.findById(id, query(function(dbItem){
                if(!dbItem) fail('cannot find ' + name + ' with id ' + id);
                for(var m in item){
                    dbItem[m] = item[m];
                }
                dbItem.save(query(function(res){
                    event.data = res;
                    next();
                }, fail));
            }, fail));
        }, success, fail, user);
    };

    route.delete = function(id, success, fail, user){
        if(!id) return fail('item._id is missing for route.delete');
        run('delete', id, function(event, next){
            model.remove({
                _id: id
            }, query(function(){
                event.data = {_id: id, ok: 1};
                next();
            }, fail));
        }, success, fail, user);
    };

    route.clear = function(success, fail, user){  // caution - clears all records in the model
        run('clear', name, function(event, next){
            model.remove().exec(query(function(res){
                event.data = res;
                next();
            }, fail));
        }, success, fail, user);

    };

    route.getAll = function(success, fail, user){
        run('getAll', name, function(event, next){
            model.find(query(function(items){
                if(!items) fail('cannot find ' + name + ' route');
                event.data = items;
                next();
            }, fail));
        }, success, fail, user);
    };

    route.find = function(object, success, fail, user){
        run('find', object, function(event, next){
            model.find(object).exec(query(function(items){
                if(!items) fail('cannot find ' + name + ' route');
                event.data = items;
                next();
            }, fail));
        }, success, fail, user);
    };

    route.filter = function(options, success, fail, user){
        run('filter', options, function(event, next){
            var count, countQuery, resultsQuery;
            if(!options.query) return fail('filter on route requires a query object');

            function gotResults(items){
                event.data = {
                    count: count,
                    items: items
                };
                next();
            }
            if(!options.strict){
                for(var m in options.query){
                    options.query[m] = new RegExp('.*' + options.query[m] + '.*');
                }
            }

            model.find(options.query).count(function(err, c){
                if(err) return fail(err);
                count = c;
                if(options.page && options.length){
                    resultsQuery = model.find(options.query);
                    resultsQuery.paginate(options.page, options.length);
                    resultsQuery.exec(query(gotResults, fail));
                }
                else{
                    model.find(options.query, query(gotResults, fail));
                }
            });
        }, success, fail, user);

    };

    route.pager = function(page, length, success, fail, user){
        run('pager', name, function(event, next){
            model.find().paginate(page, length, query(function(res){
                event.data = res;
                next();
            }, fail));
        }, success, fail, user);
    };
    route.findOne = function(obj, success, fail, user){
        run('findOne', obj, function(event, next){
            model.findOne(obj, query(function(res){
                event.data = res;
                next();
            }, fail));
        }, success, fail, user);
    };

    route.before = function(event, listener){
        return route.on('before.' + event, listener);
    };
    route.after = function(event, listener){
        return route.on('after.' + event, listener);
    };

    router.route('/' + name)

        .get(function(req, res){
            var query = req.query;
            if(query.page && query.length){
                route.pager(query.page, query.length, function(items){
                    res.end(JSON.stringify(items));
                }, function(msg){
                    error(res, msg);
                }, req.user);
            }
            else if(Object.keys(query).length < 1){
                route.getAll(function(items){
                    res.end(JSON.stringify(items));
                }, function(msg){
                    error(res, msg);
                }, req.user);
            }
            else{
                route.query(query, function(items){
                    res.send(items);
                }, function(msg){
                    error(res, msg);
                }, req.user);
            }
        })



        .post(function(req, res){
            var item = req.body;
            route.create(item, function(item){
                res.end(JSON.stringify(item));
            }, function(msg){
                error(res, msg);
            }, req.user);
        });



        /* delete all -- dev only -- remove on production !!!

        .delete(function(req, res){
            model.remove().exec(function(err){
                if(err) return error(res, err);
                res.end(JSON.stringify({success: true}));
            });
        });

         */

    router.route('/' + name + '/filter').post(function(req, res){
        var query = req.body;
        var filter = {
            page: req.query.page,
            length: req.query.length,
            query: query
        };
        route.filter(filter, function(item){
            res.send(item);
        }, function(msg){
            error(res, msg);
        }, req.user);
    });

    router.route('/' + name + '/:id')

        .get(function(req, res){
            var id = req.params.id || req.query.id || req.body.id;
            if(id){
                route.get(id, function(item){
                    res.send(item);
                }, function(msg){
                    error(res, msg);
                }, req.user);
            }
            else{
                error(res, 'you must pass an id parameter to GET:' + name + ':id');
            }
        })

        .put(function(req, res){
            var item = req.body;
            item._id = req.params.id;
            if(!item || !Object.keys(item).length){
                return error(res, 'you must pass an item to PUT:' + name)

            }
            route.update(item, function(item){
                res.end(JSON.stringify(item));
            }, function(msg){
                error(res, msg);
            }, req.user);
        })

        .delete(function(req, res){
            var id = req.params.id || req.query.id || req.body.id;
            if(id){
                route.delete(id, function(item){
                    res.end(JSON.stringify(item));
                }, function(msg){
                    error(res, msg);
                }, req.user);
            }
            else{
                error(res, 'you must pass an id parameter to DELETE:' + name + ':id');
            }
        });
    route.model = model;
    route.schema = schema;
    route.route = function(url){
        return router.route('/' + name + url);
    };
    return route;
};