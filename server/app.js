var app = require ('express')(),
    bodyParser = require ('body-parser')
    app.use(bodyParser.json({limit: '50mb'}));
    app.use(bodyParser.urlencoded({limit: '50mb'}));

var server = require ('http').createServer(app).listen(8080),
    util = require ('./util'),
    parser = require ('./parser'),
    _ = require ('underscore-node'),
    async = require ('async'),
    request = require ('request'),
    fs = require ('fs'),
    request = require ('request-promise'),
    Promise = require ('bluebird')

console.log ("[* app.js] server starts listening on 8080")

var es = require ('elasticsearch')
var client = new es.Client ({host: 'localhost:9200', log: 'error', path: './log/testing.log'})
client.ping ({requestTimeout: Infinity, hello: 'es!'})
        .then (
        function () {
        }, function (e) {
            console.trace ('es server down')
        });


app.post ('/searchListings', function (req, res) {
  // performance (/* cylinders, hp, tq, 0-60, mpg, bodytype, displacement; sort by dimensions.zerosixty, turning circle, curbweight,  /)
  // performance (/'equipments', suspension, differentinal, transmission, drivetrain, engine alignment)
  // top_safety (/* safety equipments, */)
  // no_recalls (/* sort by a/b */)
  var categorical_queries = [
    {
      name: '5/5 nhtsa overall',
      tags: [{category: 'top_safety'}]
    },
    {
      name: 'no_recalls',
      tags: [{category: 'recall', value: 0}]
    },
    {
      name: 'european',
      tags: [{category: 'makes', value: require ('./european_makes.js')}]
    },


    {
      name: '8+ cylinders',
      tags: [{category: 'cylinder', value: 8}]
    },
    {
      name: '400+ hp',
      tags: [{category: 'horsepower', value: 400}]
    },
    {
      name: 'all wheel drive',
      tags: [{category: 'drivetrain', value: ['all wheel drive']}]
    },
    {
      name: 'incentives',
      tags: [{category: 'incentives', value: true}]
    },
    {
      name: 'manual rear wheel drive',
      tags: [{category: 'transmission', value: ['manual']}, {category: 'drivetrain', value: ['rear wheel drive']}]
    },
    {
      name: 'supercharged',
      tags: [{category: 'compressorType', value: ['supercharger']}]
    },
    {
      name: '40+ mpg hwy',
      tags: [{category: 'mpg', value: 40}]
    },
    {
      name: 'least depreciation',
      tags: [{category: 'depreciation', value: 7801}]
    },
    {
      name: 'least insurance',
      tags: [{category: 'insurance', value: 9300}]
    },
    {
      name: 'least repairs',
      tags: [{category: 'repairs', value: 950}]
    },
    {
      name: 'all heated',
      tags: [
        {
          category: 'equipments', value: ["Heated Passenger Seat", "Heated Driver's Seat"]
        }
      ]
    },
    {
      name: 'limited-slip differentinal',
      tags: [
        {
          category: 'equipments',
          value: [
            "limited slip"
          ]
        }
      ]
    },
    {
      name: 'traction+stability control',
      tags: [
        {
          category: 'equipments',
          value: [
            "Traction Control",
            "Stability Control",
          ]
        }
      ]
    },
    {
      name: '10,000,000+ recalled',
      tags: [
        {
          category: 'carsRecalled',
          value: 10000000
        }
      ]
    },
    {
      name: 'front+rear stabilizer bars',
      tags: [
        {
          category: 'equipments',
          value: [
            "Rear Stabilizer Bar",
            "Front Stabilizer Bar",
          ]
        }
      ]
    },
    {
      name: 'self-adjusting suspensions',
      tags: [
        {
          category: 'equipments',
          value: [
            "Active Suspension",
            "Driver Adjustable Suspension",
            "Self Leveling Suspension"
          ]
        }
      ]
    },
    {
      name: 'massaging seat',
      tags: [
        {
          category: 'equipments',
          value: [
            'massaging'
          ]
        }
      ]
    },
    {
      name: 'xenon',
      tags: [
        {
          category: 'equipments',
          value: [
            'xenon'
          ]
        }
      ]
    },
    {
      name: 'moonroof',
      tags: [
        {
          category: 'equipments',
          value: [
            'moonroof'
          ]
        }
      ]
    },
    {
      name: 'sunroof',
      tags: [
        {
          category: 'equipments',
          value: [
            'sunroof'
          ]
        }
      ]
    },
    {
      name: 'leather',
      tags: [
        {
          category: 'equipments',
          value: [
            'leather'
          ]
        }
      ]
    },
    {
      name: 'navigation',
      tags: [
        {
          category: 'equipments',
          value: [
            'navigation'
          ]
        }
      ]
    },
    {
      name: 'bucket seats',
      tags: [
        {
          category: 'equipments',
          value: [
            'bucket'
          ]
        }
      ]
    },
    {
      name: 'post collision safety',
      tags: [
        {
          category: 'equipments',
          value: [
            'post-collision'
          ]
        }
      ]
    },
    {
      name: 'hybrid',
      tags: [
        {
          category: 'equipments',
          value: [
            'hybrid'
          ]
        }
      ]
    },
    {
      name: 'satellite traffic reporting',
      tags: [
        {
          category: 'equipments',
          value: [
            'traffic'
          ]
        }
      ]

    }
  ]
  Promise.map (categorical_queries, function (query) {
    var name = query.name,
        query = util.preprocess_query (query, 'category_page')

    return Promise.join (client.search ({index: 'car', body: query}), function (agg_res) {
      return {
        name: name,
        payload: agg_res
      }
    })
  })
  // .spread (console.log )
  .then (function (data_array) {
    var results = []
    _.each (data_array, function (data) {
      results.push (_.extend( {name: data['name']}, util.parse_listings_cnt_price (data['payload']['aggregations']['listings'])))
    })
    res.status (200).json (results)
  })
  .catch (function (err) {
    console.log (err)
    res.status (500).json (err)
  })
})

app.post ('/categoryAggregations', function (req, res) {
  try {
    if (!req.body.hasOwnProperty ('tags'))
      res.status (400).json ({'error': 'bad request, tags can\'t be null'})

    var query = util.preprocess_query (req.body, 'category_page')

    client.search ({
      index: 'car',
      body: query
    }, function (err, data) {
      if (err)
        res.status (500).json (err)
      else {
        var res_json = util.parse_listings_cnt_price (data['aggregations']['listings'])
        res.status (200).json (res_json)
      }
    })
  } catch (err) {
    res.status (500).json (err)
  }
})

app.post ('/listingPages', function (req, res) {
  try {
    if (!req.body.hasOwnProperty ('tags'))
      res.status (400).json ({'error': 'bad request, tags can\'t be null'})

    var query = util.preprocess_query (req.body, 'listings_page')

    client.search ({
      index: 'car',
      body: query
    }, function (err, data) {
        if (err)
          res.status (500).json (err)
        else {
          var ret_json = util.parse_listings (data)
          res.status (200).send (ret_json)
        }
    })

  } catch (err) {
    res.status (500).json (err)
  }
})

// app.post ('/notify', function (req, res) {
//     console.log ("received from classifier: " + req.body)
//     console.log ('client id:' + req.body.socket_id)
//     console.log ("classified label : " + req.body.classification_result['top_1'].class_name.replace (/[^a-zA-Z0-9]/g, '').toLowerCase())
//     var client = io.sockets.connected[req.body.socket_id],
//         top_n = 1,
//         pagesize = 20
//     if (req.body.classification_result.top_1.prob < 0.3) {
//         top_n = 3
//         pagesize = 5
//     }
//
//     console.log (JSON.stringify (req.body, null, 2))
//     var request_opts = {
//         'method': 'POST',
//         'url': 'http://localhost:8080/listings',
//         'headers': {'content-type': 'application/json'},
//         'json': true,
//         'body': {
//             'api': {
//                 'zipcode': 92612,
//                 'pagenum': 1,
//                 'pagesize': pagesize,
//                 'radius': 100,
//             },
//             'car': {
//                 'labels': _.pluck (req.body.classification_result.top_5.slice (0, top_n), 'class_name')
//             }
//         }
//     }
//     request( request_opts, function (err, response, body) {
//         if (err || response.statusCode != 201) {
//             console.error (err)
//             client.emit ('listings_error', JSON.stringify (err))
//             res.status (500).json (err)
//         } else {
//             client.emit ('listings', JSON.stringify (body))
//             res.status (201).json ({'message': 'listings emitted'})
//         }
//     })
// })
//
// app.get ('/vehicle_info', function (req, res) {
//     if (req.hasOwnProperty ('query') && req.query.hasOwnProperty ('styleId')) {
//         var styleId = parseInt (req.query.styleId)
//         util.connect_mongo (function (err, mongoClient) {
//             mongoClient.db('trims').collection('car_data')
//                                     .findOne ({'styleId': styleId}, function (err, doc) {
//                 if (err) {
//                     res.status (500).send ({'msg': 'server error'})
//                 }
//                 res.status (200).json (_.omit(doc, '_id'))
//             })
//         })
//     }
// })
//
// app.post ('/listings', function (req, res) {
//     var listings_query = parser.parse_listings_query (req.body.api),
//         cars_query = parser.parse_car_query (req.body.car, req.body.min_price, req.body.max_price, req.body.sortBy)
//     this.res = res
//     this.body = req.body
//     util.fetch_listings (cars_query, listings_query, util.listings_request_callback.bind (this))
// })
//
//
// app.post ('/narrowSearch', function (req, res) {
//     var listings_query = parser.parse_listings_query (req.body.api),
//         cars_query = parser.parse_car_query (req.body.car, req.body.min_price, req.body.max_price, req.body.sortBy)
//     this.body = req.body
//     this.res = res
//     util.narrow_search (cars_query, util.narrow_search_callback.bind (this))
// })
//
//
// app.post ('/classifyCar', function (req, res) {
//     var tmp_file_path = '',
//         data = req.body
//         temp.open (tmp_file_path, function (err, info) {
//             if (!err) {
//                 fs.writeFile (info.path, data.imageData, 'base64', function (err) {
//                     if (err) {
//                         callback (err)
//                     } else {
//                         fs.close (info.fd, function (err) {
//                             if (err) {
//                                 console.error (err)
//                             } else {
//                                 console.log ("[* store task] file written")
//                                 var request_opts = {
//                                     url: 'http://0.0.0.0:5000/classify',
//                                     method: "GET",
//                                     followRedirect: true,
//                                     qs: {
//                                         image_path: (info.path).replace ('/tmp/', '')
//                                     }
//                                 }
//                                 request (request_opts, function (err, clz_res, clz_body) {
//                                     if (err)
//                                         res.status (500).json (clz_body)
//                                     else {
//                                         var top_n = 1,
//                                             pagesize = 20
//                                         var clz = JSON.parse (clz_body)
//                                         console.log (JSON.stringify (clz_body, null, 2))
//                                         if (clz.top_1.prob < 0.5) {
//                                             top_n = 3
//                                             pagesize = 10
//                                         }
//                                         if (clz.top_1.prob < 0.3) {
//                                             top_n = 5
//                                             pagesize = 5
//                                         }
//
//                                         var listings_opts = {
//                                             'method': 'POST',
//                                             'url': 'http://localhost:8080/listings',
//                                             'headers': {'content-type': 'application/json'},
//                                             'json': true,
//                                             'body': {
//                                                 'api': {
//                                                     'zipcode': 92612,
//                                                     'pagenum': 1,
//                                                     'pagesize': pagesize,
//                                                     'radius': 100,
//                                                 },
//                                                 'car': {
//                                                     'labels': _.pluck (clz.top_5.slice (0, top_n), 'class_name')
//                                                 }
//                                             }
//                                         }
//                                         request( listings_opts, function (err, response, listings_body) {
//                                             if (err || response.statusCode != 201) {
//                                                 console.error (err)
//                                                 res.status (500).json (err)
//                                             } else {
//                                                 res.status (201).json (listings_body)
//                                             }
//                                         })
//                                     }
//                                 })
//                             }
//                         })
//                     }
//                 })
//             } else {
//                 callback (err)
//             }
//         })
// })
//
// app.post ('/dealerListings', function (req, res) {
//     this.res = res
//     this.body = req.body
//     util.fetch_listings_by_franchise_id (req.body, util.franchise_listings_callback.bind (this))
// })
//
//
// app.post ('/lead', function (req, res) {
//     res.status (201).json ({'message': 'request created'});
// })
//
// app.post ('/makes', function (req, res) {
//     var listings_query = parser.parse_listings_query (req.body.api),
//         vehicles_query = parser.parse_car_query (req.body.car, req.body.min_price, req.body.max_price, req.body.sortBy)
//     this.cars_query = vehicles_query
//     this.res = res
//     util.fetch_makes (cars_query, util.fetch_makes_callback.bind (this))
// })
exports = module.exports = server
