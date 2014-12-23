// all the project requirements
//var Engine = require('tingodb')(),
var path = require('path'),
assert = require('assert'),
fs = require('fs'),
util = require('util'),
chokidar = require('chokidar'),
colors = require('colors'),
WebSocketServer = require('ws').Server,
/* another lib i wanna extend right here - baseport needn't be a single one, yadidimean? */
portfinder = require('portfinder');

/* the custom diffwatch lib we write for this project */
var diffwatch = require('./diffwatch').DiffWatcher,
    utils = require('./modules/utils');

var argv = require('optimist')
.usage('Usage: $0 -dir="C:/path/to/file"')
.default('dir', path.join(process.cwd()))
.default('dbpath', null)
.default('storage', null)
.default('saverevisions', true)
.default('dbrevisions', false)
.default('usemongo', false)
.describe('dir', "folder with the files to watch and create a diff log for")
.argv;

global.argv = argv;

global.db = null;
global.connection = null;

var WORKING_DIR = argv.dir;
var DATA_DIR = path.join(WORKING_DIR, '.localdiff');
var DB_DIR = argv.dbpath || path.join(DATA_DIR, 'db');
var STORAGE_DIR = argv.storage || path.join(DATA_DIR, 'storage');
var TMP_DIR = path.join(DB_DIR, 'temp');

global.diffWatchOpts = {
  workingPath: WORKING_DIR,
  dbPath: DB_DIR,
  tempPath: TMP_DIR,
  revHistory: global.argv.saverevisions,
  dbHistory: global.argv.dbrevisions,

  db: null,
  project: null,
};

// set the project name as just the current folder
global.diffWatchOpts.projectName = path.basename(global.diffWatchOpts.workingPath);


fs.mkdir(DATA_DIR,function(e){
  if(!e || (e && e.code === 'EEXIST')) {
    makeInnerDirs();
  } else {
    util.log(colors.red(e));
    util.log(colors.red('could not check / use '+STORAGE_DIR));
  }
});

// after data dir is initially created
function makeInnerDirs() {
  fs.mkdir(STORAGE_DIR,function(e){
    if(!e || (e && e.code === 'EEXIST')) {
      global.diffWatchOpts.storageDir = STORAGE_DIR;
    } else {
      util.log(colors.red(e));
      util.log(colors.red('could not check / use '+STORAGE_DIR));
    }
  })

  // ensure the DB and TMP dir exist, if not create them
  fs.mkdir(DB_DIR,function(e){
    if(!e || (e && e.code === 'EEXIST')) {

      fs.mkdir(TMP_DIR,function(e){
        if(!e || (e && e.code === 'EEXIST')) {
          connectDb(DB_DIR);
        } else {
          util.log(colors.red(e));
          util.log(colors.red('could not generate temporary dir: '+DB_DIR));
        }
      });

    } else {
      util.log(colors.red(e));
      util.log(colors.red('could not connect to db: '+DB_DIR));
    }
  });
}

function getDb(dir)
{
  if (global.db) return db;
  if (argv.usemongo) {
    util.log(colors.gray('using mongodb'));
    global.engine = require("mongodb");
    var db;
    if (!db) db = new engine.Db(cfg.mongo.db,
      new engine.Server(argv.mongo.host, parseInt(argv.mongo.port), argv.mongo),
      {
        native_parser: false, safe:true
      });
    db.engine = global.engine;
    global.engine.name = "mongodb";
    return db;
  } else {
    util.log(colors.gray('using tingodb'));
    global.engine = require("tingodb")({});
    var db;
    if (!db) db = new engine.Db(dir, {});
    db.engine = global.engine;
    global.engine.name = "tingodb";
    return db;
  }
}

// create the db connection + start the viewing server
function connectDb(dir)
{
  util.log('connecting to db');

  var db = getDb(dir);
  global.diffWatchOpts.db = db;

  var collectionStr = dir.toString().toLowerCase().replace(/\W/g, '');
  global.diffWatchOpts.dbCollection = collectionStr;

  var project = db.project = global.diffWatchOpts.project = db.collection(collectionStr);
  var options = db.projectOptions = global.diffWatchOpts.projectOptions = db.collection(collectionStr+'_options');

  util.log(colors.green('db ready + project collection: '+collectionStr));

  function getPortStartHttp() {
    portfinder.basePort = 9000;
    portfinder.getPort(function(err, port) {
      if (err) {
        util.log(colors.red("can't get port."+err));
        return;
      }
      global.diffWatchOpts.httpPort = port;
      util.log(colors.gray('using http port: '+port));

      // start serving http and run the diffwatcher module
      serveHttp(WORKING_DIR, port);
      run();
    });
  }

  portfinder.basePort = 9070;
  portfinder.getPort(function(err, wsPort) {
    if (err) {
      util.log(colors.red("can't get websocket port."+err));
      return;
    }

    global.diffWatchOpts.wsPort = wsPort;
    util.log(colors.gray('using ws port: '+wsPort));

    // start the websocket server then the http
    serveWs(wsPort);
    getPortStartHttp();
  });
}

function serveWs(port)
{
  var wss = new WebSocketServer({ port: port });
  utils.info('websocket listening.');

  global.wss = wss;

  /* send a message to all connected clients */
  wss.broadcast = function broadcast(data) {
    if (typeof(data) != 'string')
      data = JSON.stringify(data);

    for(var i in this.clients) {
      try {
        this.clients[i].send(data);
      } catch (ex) {
        //utils.debug('wss broadcast exception: ', ex);
      }
    }
  };

  wss.on('connection', function(ws){

    // function for the handler to call
    ws.sendData = function(js)
    {
      js.status = "ok";
      try {
        ws.send(JSON.stringify(js));
      } catch (ex) {
        utils.error('error sending response packet', ex);
      }
    }

    ws.on('message', function incoming(message) {
      utils.debug('ws incom.:', message);

      if (message[0] == "{")
      {
        var msg = JSON.parse(message);
        if (global.diff_watch)
        {
          // use the servers handler
          global.diff_watch.clientCmd(msg, ws.sendData);
        }
      }
    });

    // send the handshake notification
    ws.send(JSON.stringify({
      'status': 'ok',
      'connected': true,
      'opts': getSettings()
    }));
  });
}

function serveHttp(dir, port)
{
  var http = require('http');
  var express = require('express');
  var sexstatic = require('sexstatic');

  var app = express();

  var extras = {
    'current-project.json': function() { return getSettings(); },
    'project.json': function() { return getSettings(); },
    'ws.json': {
      'content-type': 'text/json',
      'content': JSON.stringify({
        'project': global.diffWatchOpts.projectName,
        'wsPort': global.diffWatchOpts.wsPort,
        'httpPort': global.diffWatchOpts.httpPort,
        'db': {
          collectionName: global.diffWatchOpts.dbCollection,
          engine: global.engine.name
        }
      })
    }
  };

  app.use(sexstatic({ root: path.join(__dirname, 'web'), extras: extras }));
  http.createServer(app).listen(port);

  util.log(colors.green('serving http port on http://127.0.0.1:'+port+'/'));
}

function getSettings() {
  var obj = {
    'project': global.diffWatchOpts.projectName,
    'wsPort': global.diffWatchOpts.wsPort,
    'httpPort': global.diffWatchOpts.httpPort,

    'db': {
      collectionName: global.diffWatchOpts.dbCollection,
      engine: global.engine.name
    },

    'workingPath': global.diffWatchOpts.workingPath,
    'dbPath': global.diffWatchOpts.dbPath,
    'tempPath': global.diffWatchOpts.tempPath,
    'revHistory': global.diffWatchOpts.revHistory,
    'dbHistory': global.diffWatchOpts.dbHistory
  };

  return obj;
}

// called once everything is setup.
function run()
{
  global.diff_watch = new diffwatch(global.diffWatchOpts);
  global.diff_watch.wss = global.wss;
}

util.log(colors.white('run'));
