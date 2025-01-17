var _ = require ('underscore-node'),
    fs = require ('fs'),
	mongo = require ('mongodb'),
    async = require ('async'),
    OAuth = require ('oauth'),
    OAuth2 = OAuth.OAuth2,
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
        mongoClient.db ('user_tags_cars')
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
	var tmp_file_path = ''
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
        mongoClient.db ('user_tags_cars')
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

var make_reg_type = function (original_field) {
    var reg_exp_arr = []
    _.each (original_field, function (field) {
        if (field === 'Turbo')
            reg_exp_arr.push (new RegExp (field,'i'))
        else
            reg_exp_arr.push (new RegExp ("^"+ field,'i'))
    })
    return reg_exp_arr
}

var parse_model = function (original_field) {
    var reg_exp_field = []
    _.each (original_field, function (field) {
        if (field === 'Cooper') {
            reg_exp_field.push (new RegExp (field + '$'), 'i')
            reg_exp_field.push (new RegExp (field + 's$'), 'i')
            reg_exp_field.push (new RegExp (field + 'johncooperworks$'), 'i')
        }
        else if (field === 'C AMG' || field === 'E AMG' || field === 'GLA AMG' || field === 'ML AMG' ||
                field === 'G AMG' || field === 'GL AMG' || field === 'S AMG' || field === 'SL AMG' ||
                field === 'SLK AMG' || field === 'CLA AMG' || field === 'CLS AMG') {
            reg_exp_field.push (new RegExp (field.replace (' ', '\\d+'),'i'))
        } else {
            reg_exp_field.push (new RegExp (field.replace (/[^a-zA-Z0-9]/g, ''), 'i'))
        }
    })
    return reg_exp_field
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

var parse_label = function (params) {
    return params.replace (/[^a-zA-Z0-9]/g, '').toLowerCase()
                .replace(/bmw[0-9]series/, 'bmw')
                .replace(/mercedesbenz[a-z]{1,3}class/, 'mercedesbenz')
                .replace(/convertible$/, '')
                .replace(/sedan$/, '')
                .replace(/coupe$/, '')
                .replace(/truck$/, '')
                .replace(/van$/, '')
                .replace(/suv$/, '')
                .replace(/wagon$/, '')
                .replace(/hatchback$/, '')
                .replace(/facelift[0-9]{4}/, '')
}

var parse_car_query = function (query_params, min_price, max_price, sort_query) {
    console.dir (query_params)
    var query = {}
    if (_.has (query_params, 'makes') && query_params.makes.length > 0) {
        query['make'] = {'$in': make_reg_type(query_params.makes)}
    }

    if (_.has (query_params, 'models') && query_params.models.length > 0) {
        query['submodel'] = {'$in': parse_model(query_params.models)}
    }

    if (_.has (query_params, 'bodyTypes') && query_params.bodyTypes.length > 0) {
        query['bodyType'] = {'$in': make_reg_type (query_params.bodyTypes)}
    }

    if (_.has (query_params, 'years') && query_params.years.length > 0) {
        query['year'] = {'$in': query_params['years']}
    }

    if (_.has (query_params, 'labels') && query_params.labels.length > 0) {
        query['compact_label'] = new RegExp (parse_label(query_params.labels[0]))
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
        query['powertrain.mpg.highway'] = {'$gte': query_params['minMpg']}
    }

    if (_.has (query_params, 'tags') && query_params.tags.length > 0) {
        query['tags'] = {'$in': make_reg_type (query_params['tags'])}
    }

    if (_.has (query_params, 'drivenWheels') && query_params.drivenWheels.length > 0) {
        query['powertrain.drivenWheels'] = {'$in': query_params['drivenWheels']}
    }

    if (sort_query === 'mpg:asc') {
        query['sortBy'] = [['powertrain.mpg.highway', 1]]
    }
    if (sort_query === 'mpg:desc') {
        query['sortBy'] = [['powertrain.mpg.highway', -1]]
    }
    if (sort_query === 'horsepower:asc') {
        query['sortBy'] = [['powertrain.engine.horsepower', 1]]
    }
    if (sort_query === 'horsepower:desc') {
        query['sortBy'] = [['powertrain.engine.horsepower', -1]]
    }
    if (sort_query === 'torque:asc') {
        query['sortBy'] = [['powertrain.engine.torque', 1]]
    }
    if (sort_query === 'torque:desc') {
        query['sortBy'] = [['powertrain.engine.torque', -1]]
    }
    if (sort_query === 'complaints:asc') {
        query['sortBy'] = [['complaints.count', 1]]
    }
    if (sort_query === 'complaints:desc') {
        query['sortBy'] = [['complaints.count', -1]]
    }
    if (sort_query === 'recalls:asc') {
        query['sortBy'] = [['recalls.numberOfRecalls', 1]]
    }
    if (sort_query === 'recalls:desc') {
        query['sortBy'] = [['recalls.numberOfRecalls', -1]]
    }
    if (sort_query === 'year:asc') {
        query['sortBy'] = [['year', 1]]
    }
    if (sort_query === 'year:desc') {
        query['sortBy'] = [['year', -1]]
    }
    if (sort_query === undefined) {
        query['sortBy'] = [['year', -1]]
    }

    if (max_price !== undefined || min_price !== undefined) {
        query['$or'] = []
        query['$or'].push ({$or: [{'prices.usedTmvRetail': {'$lte': max_price}}, {'prices.usedTmvRetail': {'$exists': false}}]})
        query['$or'].push ({$or: [{'prices.usedPrivateParty': {'$lte': max_price}}, {'prices.usedPrivateParty': {'$exists': false}}]})
    }

    if (_.has (query_params, 'remaining_submodels') && query_params.remaining_submodels.length > 0) {
        var last_query = {}
        last_query['submodel'] = {'$in': query_params.remaining_submodels}
        if (query.hasOwnProperty ('sortBy'))
            last_query['sortBy'] = query['sortBy']
        else
            last_query['sortBy'] = [['year', -1]]

        if (query.hasOwnProperty ('$or'))
            last_query['$or'] = query['$or']
        return last_query
    }

    if (_.has (query_params, 'fetched_submodels') && query_params.remaining_submodels.length > 0) {
        var last_query = {}
        last_query['submodel'] = {'$in': query_params.fetched_submodels}
        if (query.hasOwnProperty ('sortBy'))
            last_query['sortBy'] = query['sortBy']
        else
            last_query['sortBy'] = [['year', -1]]

        if (query.hasOwnProperty ('$or'))
            last_query['$or'] = query['$or']
        return last_query
    }



    return query
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
                data.styleId = styleId
                callback (null, data)
            } catch (e) {
                callback (err, null)
            }
        }
    })
}

var update_listing_stats = function (listing_stats, callback) {
    connect_mongo (function (err, mongoClient) {
        if (err)
            console.error (err)
        console.dir (listing_stats)
        mongoClient.db ('trims').collection ('car_data').update (
            {'styleId': listing_stats.styleId},
            {'$set': {'listings_stats': _.omit (listing_stats, 'styleId')}},
            function (err, res) {
                if (err)
                    console.dir (err)
                mongoClient.close()
                callback (null)
            })
    })
}

var listings_request_worker = function (styleIds, edmunds_query, car_doc ,api_callback) {
        var listing_tasks = [],
            remaining_style_ids = []
        
        async.retry (3, get_token, function (err, access_token_) {
            if (err) {
                api_callback (null, {'count':0, 'listings': [], remaining_ids: []})
            } else {
                var res_per_req = 10
                var request_opts = {
                        method: "GET",
                        followRedirect: true,
                        qs: {
                            access_token: access_token_,
                            fmt: 'json',
                            view: 'full',
                            pagesize: res_per_req
                        }
                }
                request_opts.qs = _.extend (request_opts.qs, edmunds_query)
                _.each (styleIds, function (styleId) {
                    var listing_worker = function (callback) {
                        fetch_edmunds_listings (request_opts, styleId, callback)
                    }.bind (this)
                    listing_tasks.push (listing_worker)
                })

                async.parallelLimit (listing_tasks, 10, function (err, results) {
                    if (err) {
                        console.log (err)
                        api_callback (null, {})
                    } else {
                        try {
                            var tasks = []
                            var callback_stats = 
                            _.each (results, function (style_id_res) {
                                var res = _.omit (style_id_res, 'inventories', 'links')
                                res.zipcode = edmunds_query.zipcode
                                res.radius = edmunds_query.radius
                                var update_stats_task = function (update_callback) {
                                    update_listing_stats (res, update_callback)
                                }
                                tasks.push (async.ensureAsync(update_stats_task))
                            })
                            async.parallelLimit (tasks, 5, function (err, res) {
                                if (err)
                                    console.error (err)
                                api_callback (null, {})
                            })
                        } catch (exp) {
                            console.error ('[ ERR fetching listings]' + exp)
                            api_callback (null, {})
                        }
                    }
                })
            }
        })

}

var submodel_worker = function (max_per_model, submodel_doc, db_query ,edmunds_query, callback) {
    connect_mongo (function (err, mongoClient) {
        db_query.submodel = submodel_doc.submodel
        mongoClient.db ('trims').collection ('car_data').distinct ('styleId', _.omit(db_query, 'sortBy'),
                function (err, styleIds) {
                    mongoClient.close()
                    if (err) {
                        console.error ('[* ERR ' + submodel +']: ' + err)
                        callback (null, {'count':0, 'listings': [], 'styleIds': [], 'submodels': []})
                    } else {
                        console.log ('[* fetched ' + styleIds.length +' styleIds for ' + submodel_doc.submodel + ' ]')
                        listings_request_worker (styleIds.slice (0,1000000), edmunds_query, submodel_doc ,callback)
                    }
                })
    })
}

var fetch_listings = function (db_query, edmunds_query, listings_callback) {
    var query_obj = {},
        sort = {}
        if (db_query.hasOwnProperty('sortBy')) {
            query_obj = _.omit(db_query, 'sortBy')
            sort = db_query.sortBy            
        } else {
            query_obj = db_query
        }

        console.dir (db_query)
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
                            'powertrain.transmission.transmissionType': 1,
                            'good_tags': 1             
                        }).sort (sort).toArray (
                            function (err, submodels_docs) {
                                mongoClient.close()
                                if (err) {
                                    console.log (err)                    
                                } else {
                                    console.log ('[* fetched ' + submodels_docs.length +' submodels ]\n[* submodels: ]')
                                    this.submodels = _.pluck (submodels_docs, 'submodel')
                                    this.submodels_docs = submodels_docs
                                    var tasks = []
                                    _.each (submodels_docs, function (submodel_doc) {
                                        var worker = function (callback) {
                                            submodel_worker (100000, submodel_doc, db_query, edmunds_query, callback)
                                        }.bind (this)
                                        tasks.push (worker)
                                    })
                                    async.parallelLimit (tasks, 10, listings_callback.bind(this))
                                }           
                            }
                        )
        })
}

var construct_query_stats = function (queries, fetched_submodels) {
    var query = {}
    query.makes = _.uniq (_.pluck (queries, 'make'))
    query.models = _.uniq (_.pluck (queries, 'model'))
    query.bodyTypes = _.uniq (_.pluck (queries, 'bodyType'))
    query.years = _.uniq (_.pluck (queries, 'year'))
    query.tags = _.filter (_.uniq (_.flatten(_.pluck (queries, 'good_tags'))), function (tag) {return tag !== null && tag !== undefined})

    query.drivenWheels = []
    query.cylinders = []
    query.compressors = []
    query.transmissionTypes = []
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
        if (powertrain.hasOwnProperty ('transmission') && powertrain.transmission.hasOwnProperty('transmissionType')) {
            query.transmissionTypes.push (powertrain.transmission.transmissionType)
        }
    })
    query.cylinders = _.uniq (query.cylinders)
    query.compressors = _.uniq (query.compressors)
    query.transmissionTypes = _.uniq (query.transmissionTypes)
    query.drivenWheels = _.uniq (query.drivenWheels)
    query.remaining_submodels = _.difference (fetched_submodels, _.pluck (queries, 'submodel'))
    query.fetched_submodels = fetched_submodels
    return query
}


var has_color = function (listing_colors, type, color_query) {
    if (color_query === undefined || color_query.length < 1)
        return true

    if (listing_colors === undefined)
        return false

    var color_object = _.first (_.filter (listing_colors, function (color) {return color.category === type} ))
    if (color_object === undefined || !color_object.hasOwnProperty ('genericName'))
        return false

    var ret = false
    _.each (color_query, function (color) {
        if (color_object.genericName.toLowerCase().indexOf (color) > -1)
            ret = true
    })
    return ret
}

var has_equipment = function (equipments, query_equipments) {
    if (query_equipments === undefined || query_equipments.length < 1)
        return true

    if (equipments === undefined)
        return false
}

var listings_request_callback = function (err, listings) {
    if (err)
        console.dir (err)
    var response_obj = {},
        max_mileage = 5000000,
        max_price = 5000000,
        min_price = 0

    if (this.body.hasOwnProperty ('max_mileage')) {
        console.log (max_mileage)
        if (this.body.max_mileage !== "No Max")        
            max_mileage = this.body.max_mileage
    }
    if (this.body.hasOwnProperty ('max_price') {
        console.log (max_price)
        if (this.body.max_price !== "No Max")
            max_price = this.body.max_price
    }
    console.log ('[* prefiltered listings count : ' + _.flatten(_.pluck(listings, 'listings')).length + ' ]')
    response_obj['listings'] =  _.filter (
                                    _.map (
                                        _.flatten(
                                            _.pluck(listings, 'listings')
                                        ),
                                        listing_formatter
                                    ), function (listing) {
                                        return (
                                                listing !== undefined && 
                                                // listing.min_price <= max_price &&
                                                listing.mileage <= max_mileage &&
                                                has_color (listing.colors, 'Interior', this.body.api.int_colors) &&
                                                has_color (listing.colors, 'Exterior', this.body.api.ext_colors))
                                                // has_equipment (_.union (listing.options, listing.features), this.body.features))
                                    }
                                )
    response_obj['count'] = response_obj['listings'].length
    response_obj['query'] = this.body
    var next_query = construct_query_stats (this.submodels_docs, this.submodels)
    next_query.minMpg = this.body.car.minMpg
    next_query.minHp = this.body.car.minHp
    next_query.minTq = this.body.car.minTq
    response_obj['query'].car = next_query
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
            return listing.year.year
        })
    }
    if (this.body.hasOwnProperty ('sortBy') && this.body.sortBy === 'year:desc') {
        response_obj['listings'] =  _.sortBy (response_obj['listings'], function (listing) {
            return 5000000 - listing.year.year
        })
    }
    this.res.status (201).json (response_obj)
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

    var formatted_listing = _.omit (listing, 'equipment')
    return listing
}

exports.connect_mongo = module.exports.connect_mongo = connect_mongo
exports.store_to_mongo = module.exports.store_to_mongo = store_to_mongo
exports.store_to_disk = module.exports.store_to_disk = store_to_disk
exports.write_classifier_result = module.exports.write_classifier_result = write_classifier_result
exports.fetch_listings = module.exports.fetch_listings = fetch_listings
exports.submodel_worker = module.exports.submodel_worker = submodel_worker
exports.parse_listings_query = module.exports.parse_listings_query = parse_listings_query
exports.parse_car_query = module.parse_car_query = parse_car_query
exports.listings_request_worker = module.listings_request_worker = listings_request_worker
exports.listings_request_callback = module.listings_request_callback = listings_request_callback
