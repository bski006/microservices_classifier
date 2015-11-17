var _ = require ('underscore-node'),
    fs = require ('fs'),
	mongo = require ('mongodb'),
    async = require ('async'),
    OAuth = require ('oauth'),
    OAuth2 = OAuth.OAuth2
    request = require ('request'),
    MONGO_HOST = process.env['DB_PORT_27017_TCP_ADDR'] || 'localhost',
    MONGO_PORT = process.env['DB_1_PORT_27017_TCP_PORT'] || '27017'

var connect_mongo = function (callback) {
    var mongo_client = mongo.MongoClient
    server = mongo.Server
    client = new mongo_client (new server (MONGO_HOST, MONGO_PORT), {native_parser: true})
    client.open (function (err, mongoClient) {
        if (err)
            callback (err, null)
        else
            callback (null, mongoClient)
    })
}

var store_to_mongo = function (data, callback) {
    connect_mongo (function (err, mongoClient) {
        mongoClient.db ('hdd')
                   .collection ('classifications')
                   .insert (_.omit (data, 'imageData'), function (err, docs) {
                        mongoClient.close()
                        if (err) {
                            callback (err, null)
                        } else {
                            callback (null, {object_id: docs[0]._id})
                        }
                   })
	})
}

var store_to_disk = function (data, callback, temp) {
	var tmp_file_path = 'hdd_uploads/'
        temp.open (tmp_file_path, function (err, info) {
            if (!err) {
                fs.writeFile (info.path, data.imageData, 'base64', function (err) {
                    if (err) {
                        callback (err)
                    } else {
                        console.log ("file written")
                        fs.close (info.fd, function (err) {
                            if (err) {
                                client.emit ('err', 'cannot store to server')
                                callback (err)                                
                            } else {
                                client.emit ('progress', 'stored_on_server')
                                callback (null, {tmp_path: info.path})
                            }
                        })

                    }
                })
            } else {
    	    	callback (err)
    	    }
        })                
}

var write_classifier_result = function (classification_result, _id, callback) {
    connect_mongo (function (err, mongoClient) {
        mongoClient.db ('hdd')
               .collection ('classifications')
               .update ({'_id': require('mongodb').ObjectID(_id)},
                        { $set: {'classifications': classification_result} },
                        function (err, result) {
                            mongoClient.close()
                            console.log ('[util] result in db')
                            callback (err, result)
                        })
    })
}

var get_token = function (callback, results) {  
        var edmunds_client_key="d442cka8a6mvgfnjcdt5fbns",
            edmunds_client_secret="tVsB2tChr7wXqk47ZZMQneKq",
            OAuth2 = require ('oauth').OAuth2,
            oauth2 = new OAuth2 (   
                                    edmunds_client_key, 
                                    edmunds_client_secret,
                                    'https://api.edmunds.com/inventory/token',
                                    null, 'oauth/token', null
                                )

        oauth2.getOAuthAccessToken ('', 
                                    {'grant_type': 'client_credentials'}, 
                                    function (err, access_token, refresh_token, results) {
                                    if (err) {
                                        console.log (err)
                                        callback (err, null)
                                    } else {
                                        callback (null, access_token)
                                    }
                                    });
}

var fetch_edmunds_listings = function (request_opts, styleId, callback) {
    request_opts.url = 'https://api.edmunds.com/api/inventory/v2/styles/' + styleId
    request (request_opts, function (err, res, body) {
        if (err) {
            callback (err, null)
        } else if (res.statusCode != 200) {
            callback ({status: res.statusCode}, null)
        } else {
            try {
                var data = JSON.parse (body)
                callback (null, data)
            } catch (e) {
                callback (err, null)
            }
        }
    })
}

var listings_request_worker = function (styleIds, edmunds_query, car_doc ,api_callback) {
        var listing_tasks = [],
            remaining_style_ids = []
        
        async.retry (3, get_token, function (err, access_token_) {
            if (err) {
                api_callback (null, {'count':0, 'listings': [], remaining_ids: []})
            } else {
                var res_per_req = 50
                if (styleIds.length > 0) {
                    res_per_req = edmunds_query.pagesize / (styleIds.length)
                    if (res_per_req < 50)
                        res_per_req = 50
                }
                var request_opts = {
                        method: "GET",
                        followRedirect: true,
                        qs: {
                            access_token: access_token_,
                            fmt: 'json',
                            view: 'basic',
                            pagesize: res_per_req
                        }
                }
                request_opts.qs = _.extend (request_opts.qs, edmunds_query)
                if (styleIds.length > 10) {
                    remaining_style_ids = styleIds.slice (10, styleIds.length)                    
                    styleIds = styleIds.slice (0, 10)
                }

                _.each (styleIds, function (styleId) {
                    var listing_worker = function (callback) {
                        fetch_edmunds_listings (request_opts, styleId, callback)
                    }.bind (this)
                    listing_tasks.push (listing_worker)
                })

                async.parallelLimit (listing_tasks, 10, function (err, results) {
                    if (err) {
                        api_callback (err, null)
                    } else {
                        var response_obj = {}
                        try {
                            response_obj['listings'] =  _.map (_.flatten(_.pluck(results, 'inventories')), function (listing) {
                                if (car_doc.hasOwnProperty ('powertrain') && 
                                    car_doc.powertrain.hasOwnProperty('engine') &&
                                    car_doc.powertrain.engine.hasOwnProperty('horsepower'))
                                    listing.horsepower = car_doc.powertrain.engine.horsepower
                                if (car_doc.hasOwnProperty ('powertrain') && 
                                    car_doc.powertrain.hasOwnProperty('engine') &&
                                    car_doc.powertrain.engine.hasOwnProperty('torque'))
                                    listing.torque = car_doc.powertrain.engine.torque
                                if (car_doc.hasOwnProperty ('mpg') && car_doc.mpg.hasOwnProperty('city'))
                                    listing.citympg = car_doc.powertrain.mpg.city
                                if (car_doc.hasOwnProperty ('complaints') && car_doc.complaints.hasOwnProperty('count'))
                                    listing.complaints_cnt = car_doc.complaints.count
                                if (car_doc.hasOwnProperty ('recalls') && car_doc.recalls.hasOwnProperty('numberOfRecalls'))
                                    listing.recalls_cnt = car_doc.recalls.numberOfRecalls
                                return listing                              
                            })
                            response_obj['count'] = response_obj['listings'].length
                            response_obj['query'] = car_doc
                            console.log ("[* " + response_obj['count'] + "] listings fetched")
                            api_callback (err, response_obj)
                        } catch (exp) {
                            console.error ('[ ERR fetching listings]' + exp)
                            api_callback (null, {'count':0, 'listings': [], remaining_ids: []})
                        }
                    }
                })
            }
        })

}

var submodel_worker = function (max_per_model, submodel_doc, edmunds_query, callback) {
    connect_mongo (function (err, mongoClient) {
        mongoClient.db ('trims').collection ('car_data').distinct ('styleId', 
                                                                    {'submodel': submodel_doc.submodel},
                function (err, styleIds) {
                    mongoClient.close()
                    if (err) {
                        console.error ('[* ERR ' + submodel +']: ' + err)
                        callback (null, {'count':0, 'listings': [], 'styleIds': [], 'submodels': []})
                    } else {
                        console.log ('[* fetched ' + styleIds.length +' styleIds for ' + submodel_doc.submodel + ' ]')
                        if (styleIds.length > 200)
                            styleIds = styleIds.slice (0, 200)
                        listings_request_worker (styleIds, edmunds_query, submodel_doc ,callback)
                    }
                })
    })
}

var fetch_listings = function (db_query, edmunds_query, listings_callback) {
    console.log (db_query)
    var query_obj = {},
        sort = {}
        if (db_query.hasOwnProperty('sortby')) {
            query_obj = _.omit(db_query, 'sortby')
            sort = db_query.sortby            
        } else {
            query_obj = db_query
        }
        console.log (db_query)
        connect_mongo (function (err, mongoClient) {
            mongoClient.db ('trims').collection ('car_data')
                .find ( query_obj, 
                        {
                            'powertrain.engine.horsepower':1 ,
                            'powertrain.engine.torque':1,
                            'powertrain.mpg': 1,
                            'complaints.count': 1,
                            'recalls.numberOfRecalls': 1,
                            'submodel': 1,
                            'make': 1,
                            'model': 1,
                            'bodyType': 1,
                            'year': 1,
                            'powertrain.engine.compressorType': 1,
                            'powertrain.engine.cylinder': 1,
                            'powertrain.drivenWheels': 1,
                            'tags': 1             
                        }).sort (sort).toArray (
                            function (err, submodels_docs) {
                                mongoClient.close()
                                if (err) {
                                    console.log (err)                    
                                } else {
                                    console.log ('[* fetched ' + submodels_docs.length +' submodels ]\n[* submodels: ]')
                                    if (submodels_docs.length > 200)
                                        submodels_docs = submodels_docs.slice (0, 200)
                                    var tasks = []
                                    _.each (submodels_docs, function (submodel_doc) {
                                        var worker = function (callback) {
                                            submodel_worker (20, submodel_doc, edmunds_query, callback)
                                        }.bind (this)
                                        tasks.push (worker)
                                    })
                                    async.parallelLimit (tasks, 20, listings_callback)
                                }           
                            }
                        )
        })
}

var make_reg_type = function (original_field) {
    var reg_exp_arr = []
    _.each (original_field, function (field) {
        reg_exp_arr.push (new RegExp ("^"+ field,'i'))
    })
    return reg_exp_arr
}

var parse_listings_query = function (params) {
    var obj = {}
    _.each (['zipcode', 'pagesize', 'pagenum', 'radius', 'intcolor',
            'extcolor', 'msrpmin', 'msrpmax', 'lpmin', 'lpmax', 'type', 'sortby'], 
            function (key) {
                if (params.hasOwnProperty (key)) {
                    obj[key] = params[key]
                }
    })
    return obj
}

var parse_car_query = function (query_params, min_price, max_price) {
    var query = {}
    if (_.has (query_params, 'makes') && query_params.makes.length > 0) {
        query['make'] = {'$in': make_reg_type(query_params.makes)}
    }

    if (_.has (query_params, 'models') && query_params.models.length > 0) {
        query['submodel'] = {'$in': make_reg_type(query_params.models)}
    }

    if (_.has (query_params, 'bodyTypes') && query_params.bodyTypes.length > 0) {
        query['bodyType'] = {'$in': make_reg_type (query_params.bodyTypes)}
    }

    if (_.has (query_params, 'years') && query_params.years.length > 0) {
        query['year'] = {'$in': query_params['years']}
    }

    if (_.has (query_params, 'transmissionTypes') && query_params.transmissionTypes.length > 0) {
        query['powertrain.transmission.transmissionType'] = {'$in': make_reg_type(query_params.transmissionTypes)}
    }

    if (_.has (query_params, 'compressors') && query_params.compressors.length > 0) {
        query['powertrain.engine.compressorType'] = {'$in': make_reg_type(query_params.compressors)}
    }
    if (_.has (query_params, 'cylinders') && query_params.cylinders.length > 0) {
        query['powertrain.engine.cylinder'] = {'$in': query_params['cylinders']}
    }
    if (_.has (query_params, 'minHp')) {
        query['powertrain.engine.horsepower'] = {'$gte': query_params['minHp']}
    }

    if (_.has (query_params, 'minTq')) {
        query['powertrain.engine.torque'] = {'$gte': query_params['minTq']}
    }

    if (_.has (query_params, 'minMpg')) {
        query['powertrain.mpg.city'] = {'$gte': query_params['minMpg']}
    }

    if (_.has (query_params, 'tags')) {
        query['tags'] = {'$all': make_reg_type (query_params['tags'])}
    }

    if (_.has (query_params, 'drivenWheels')) {
        query['powertrain.drivenWheels'] = {'$in': query_params['drivenWheels']}
    }

    if (_.has (query_params, 'sortby')) {
        query['sortby'] = query_params.sortby
    }

    if (max_price !== undefined || min_price !== undefined) {
        query['$or'] = []
        query['$or'].push ({$or: [{'prices.usedTmvRetail': {'$lte': max_price}}, {'prices.usedTmvRetail': {'$exists': false}}]})
        query['$or'].push ({$or: [{'prices.usedPrivateParty': {'$lte': max_price}}, {'prices.usedPrivateParty': {'$exists': false}}]})
    }
    return query
}

var construct_query_stats = function (queries) {
    var query = {}
    query.makes = _.uniq (_.pluck (queries, 'make'))
    query.models = _.uniq (_.pluck (queries, 'model'))
    query.bodyTypes = _.uniq (_.pluck (queries, 'bodyType'))
    query.tags = _.uniq (_.flatten(_.pluck (queries, 'tags')))

    query.drivenWheels = []
    query.cylinders = []
    query.compressors = []
    _.each (_.pluck (queries, 'powertrain'), function (powertrain) {
        if (powertrain.hasOwnProperty ('drivenWheels')) {
            query.drivenWheels.push (powertrain.drivenWheels)
        }
        if (powertrain.hasOwnProperty ('engine') && powertrain.engine.hasOwnProperty ('cylinder')) {
            query.cylinders.push (powertrain.engine.cylinder)
        }
        if (powertrain.hasOwnProperty ('engine') && powertrain.engine.hasOwnProperty ('compressorType')) {
            query.compressors.push (powertrain.engine.compressorType)
        }
    })
    query.drivenWheels = _.uniq (query.drivenWheels)
    query.cylinders = _.uniq (query.cylinders)
    query.compressors = _.uniq (query.compressors)
    return query
}

var listings_request_callback = function (err, listings) {
    var response_obj = {},
        max_mileage = 5000000,
        max_price = 5000000,
        min_price = 0

    if (this.body.hasOwnProperty ('max_mileage'))
        max_mileage = this.body.max_mileage
    if (this.body.hasOwnProperty ('min_price'))
        min_price = this.body.min_price
    if (this.body.hasOwnProperty ('max_price'))
        max_price = this.body.max_price

    console.log ('[* prefiltered listings count : ' + _.flatten(_.pluck(listings, 'listings')).length + ' ]')
    response_obj['listings'] =  _.filter (
                                    _.map (
                                        _.flatten(
                                            _.pluck(listings, 'listings')
                                        ),
                                        listing_formatter
                                    ), function (listing) {
                                        return (listing !== undefined && 
                                                listing.min_price >= min_price &&
                                                listing.min_price <= max_price &&
                                                listing.mileage <= max_mileage)
                                    }
                                )
    response_obj['count'] =  response_obj['listings'].length
    response_obj['query'] = construct_query_stats (_.flatten (_.pluck (listings, 'query')))
    // response_obj['remaining_models'] =  _.flatten(_.pluck(results, 'remaining_models'))
    // response_obj['remaining_ids'] =  _.flatten(_.pluck(results, 'remaining_ids'))
    if (this.body.hasOwnProperty ('sortBy') && this.body.sortBy === 'mileage:asc') {
        response_obj['listings'] =  _.sortBy (response_obj['listings'], function (listing) {
            return listing.mileage
        })
    }
    if (this.body.hasOwnProperty ('sortBy') && this.body.sortBy === 'mileage:desc') {
        response_obj['listings'] =  _.sortBy (response_obj['listings'], function (listing) {
            return 5000000 - listing.mileage
        })
    }
    if (this.body.hasOwnProperty ('sortBy') && this.body.sortBy === 'price:asc') {
        response_obj['listings'] =  _.sortBy (response_obj['listings'], function (listing) {
            return listing.min_price
        })
    }
    if (this.body.hasOwnProperty ('sortBy') && this.body.sortBy === 'price:desc') {
        response_obj['listings'] =  _.sortBy (response_obj['listings'], function (listing) {
            return 5000000 - listing.min_price
        })
    }
    if (this.body.hasOwnProperty ('sortBy') && this.body.sortBy === 'year:asc') {
        response_obj['listings'] =  _.sortBy (response_obj['listings'], function (listing) {
            return year.year
        })
    }
    if (this.body.hasOwnProperty ('sortBy') && this.body.sortBy === 'year:desc') {
        response_obj['listings'] =  _.sortBy (response_obj['listings'], function (listing) {
            return 5000000 - year.year
        })
    }

    if (err) {
        this.res.status (500).json (err)
    } else {
        this.res.status (201).json (response_obj)
    }
}

var listing_formatter = function (listing) {
    if (listing !== undefined && listing.hasOwnProperty ('media') && 
        listing.media.hasOwnProperty ('photos') && 
        listing.media.photos.hasOwnProperty ('large') && 
        listing.media.photos.large.count > 1) {
        listing.media.photos.large.links = _.sortBy (listing.media.photos.large.links, function (photo) {
            var matched_nums = photo.href.match (new RegExp (/\d+/g))
            return parseInt (matched_nums[matched_nums.length -1])
        })
    }
    if (listing !== undefined && listing.hasOwnProperty ('prices'))
        listing.min_price = _.filter (_.values (listing.prices), function (price) {return price > 0}).sort()[0]

    return listing
}

exports.connect_mongo = module.exports.connect_mongo = connect_mongo
exports.store_to_mongo = module.exports.store_to_mongo = store_to_mongo
exports.store_to_disk = module.exports.store_to_disk = store_to_disk
exports.write_classifier_result = module.exports.write_classifier_result = write_classifier_result
exports.fetch_listings = module.exports.fetch_listings = fetch_listings
exports.parse_listings_query = module.exports.parse_listings_query = parse_listings_query
exports.parse_car_query = module.parse_car_query = parse_car_query
exports.listings_request_worker = module.listings_request_worker = listings_request_worker
exports.listings_request_callback = module.listings_request_callback = listings_request_callback
