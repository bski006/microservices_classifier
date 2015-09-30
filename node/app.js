var app = require ('express')(),
    server = require ('http').createServer(app).listen(8080),
    io = require ('socket.io').listen(server),
    bodyParser = require ('body-parser'),
    util = require ('./util'),
    amqp = require ('amqplib'),
    _ = require ('underscore-node'),
    async = require ('async'),
    temp = require ('temp')

app.use (bodyParser.urlencoded ({ extended: true }))
console.log ("Socket server listening on 8080")
temp.track()


var channel = "",
    hdd_exchange = 'hdd',
    channel_opts = {durable: false}

amqp.connect ('amqp://localhost', function (err, conn) {
    if (err)
        console.log ("amqp conn error")
    conn.createChannel (function (err, ch) {
        ch.assertExchange(hdd_exchange, 'topic', exopts, function(err, ok) {
            if (err)
                console.log ('amqp channel creation err')
            channel = ch
        })
    })
})

io.on ('connection', function (socket) {
	console.log ("connected " + socket)
})

io.sockets.on ('connection', function (client) {
		/* emit the register event, give client its id */
	client.emit ('register', client.id)
	console.log ("client connected: " + client.id)
	
	client.on ('clz_data', function (data) {
		console.log ("client " + client.id + " sent clz data ")
		console.dir (data)
        util.connect_mongo (function (err, mongoClient) {
                clz_coll = mongoClient.db ('hdd').collection ('classifications')

        var mongo_store_minitask = function (callback) {
            util.store_to_mongo (client, data, callback)
        }

        var local_store_minitask = function (callback) {
            util.store_to_disk (client, data, callback, temp)
        }
        async.parallel ([mongo_store_minitask, local_store_minitask], function (err, res) {
                if (err) {
                    client.emit ('err', 'init_task_error')                    
                } else {
                    var channel_msg = {
                            object_id: _.pluck (res, 'object_id'), 
                            file_path: _.pluck (res, 'tmp_path')
                    }
                    console.log (channel_msg)
                    channel.publish (hdd_exchange, 'classify', channel_msg)
                }
            })
    	})
    })
	client.on ('disconnect', function () {
        console.log ("client " + client.id + " disconnected")
    })
}) 

app.post ('/notify', function (req, res) {
    var client = io.sockets[req.body.socket_id]
    console.log (client.sockets)
    client.emit ('classification_result', req.body.classification_result)
    res.type ('text/plain')
    res.send ('Response Sent To Mobile socket[' + req.body.socket_id + ']')
})

app.post ('/classifications', function (req, res) {
    util.connect_mongo (function (err, mongoClient) {
        var clz_coll = mongoClient.db ('hdd').collection ('classifications'),
    	query_obj = {}
        clz_coll.find (query_obj)
                .limit(req.body.pageSize)
                .sort ({'date_created': -1})
                .toArray (function (err, results) {
                    if (err)
                        res.status (500)
                    else
                        res.json ({samples: results})
                })
        mongoClient.close()
    })
})
