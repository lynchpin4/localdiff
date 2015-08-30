// all the project requirements
//var Engine = require('tingodb')(),
var path = require('path'),
assert = require('assert'),
fs = require('fs'),
util = require('util'),
chokidar = require('chokidar'),
colors = require('colors'),
extend = require('extend'),
WebSocketServer = require('ws').Server,
ConfigurationBuilder = require('./configuration'),
/* another lib i wanna extend right here - baseport needn't be a single one, yadidimean? */
portfinder = require('portfinder');

/* the custom diffwatch lib we write for this project */
var diffwatch = require('./diffwatch'),
    utils = require('./modules/utils');

var argv = require('optimist')
    .usage('Usage: $0 -dir="C:/path/to/file"')
    .default('path', path.join(process.cwd()))
    .default('dataPath', path.join(process.cwd()))
    .default('saverevisions', true)
    .default('dbrevisions', false)
    .default('usemongo', false)
    .describe('path', "folder with the files to watch and create a diff log for")
  .argv;

global.db = null;
global.connection = null;

// instance options
var diffWatchOpts = {
  revHistory: argv.saverevisions,
  dbHistory: argv.dbrevisions,

  db: null,
  project: null,
};

// recaluate paths (after config load)
function recalculatePaths(dir, dataPath, storagePath, tempPath)
{
  // path to the folder to watch
  if (dir == null)
    dir = process.cwd();

  // the .localdiff or w.e
  if (dataPath == null)
    dataPath = path.join(dir, '.localdiff');

  // revision files (whole) + other saved storage - meant to be user readable
  if (storagePath == null)
    storagePath = path.join(dataPath, 'storage');

  // temporary (but sometimes artifacts from this folder get moved and saved elsewhere)
  if (tempPath == null)
    tempPath = path.join(dataPath, 'temp');

  var paths = {
    workingPath: dir,
    storagePath: storagePath,
    dataDir: dataPath,
    dbPath: path.join(dataPath, 'db'),
    tempPath: tempPath
  }

  extend(diffWatchOpts, paths);

  diffwatch.debug('recalculated paths..');
}

// set the project name as just the current folder (default)
if (!diffWatchOpts.projectName)
  diffWatchOpts.projectName = path.basename(diffWatchOpts.workingPath);

console.log('the opts');
console.dir(diffWatchOpts);

// try and load local config
var localConfig = path.join(process.cwd(), 'localdiff.js');
console.log('loading diff config from: '+localConfig);
if (fs.existsSync(localConfig))
{
  var config = JSON.parse(fs.readFileSync(localConfig));
  
  diffwatch.debug('loaded '+localConfig);
  extend(diffWatchOpts, config);

  if (diffWatchOpts.project)
    diffWatchOpts.projectName = diffWatchOpts.project;

  // dir, dataPath, storagePath, tempPath
  recalculatePaths(diffWatchOpts.workingPath, diffWatchOpts.dataDir, diffWatchOpts.storagePath, diffWatchOpts.tempPath);
  extend(diffWatchOpts, config);
} else {
  
  console.dir(argv);
  console.log('---')
  
  // create a default config
  var configBuilder = new ConfigurationBuilder(argv);
  var config = configBuilder.createConfig();
  
  console.log('No default config found, created one based on the current directory.');
  console.dir(config);
  
  fs.writeFileSync(path.join(config.path, "localdiff.json"), JSON.stringify(config));
  console.log('wrote config file to '+path.join(config.path, "localdiff.json"));
}

recalculatePaths(argv.path, argv.dataPath);

// create / validate the data dirs.. start
fs.mkdir(diffWatchOpts.dataDir,function(e){
  if(!e || (e && e.code === 'EEXIST')) {
    makeInnerDirs();
  } else {
    util.log(colors.red(e));
    util.log(colors.red('could not check / use '+diffWatchOpts.storagePath));
  }
});

// after data dir is initially created
function makeInnerDirs() {
  fs.mkdir(diffWatchOpts.storagePath,function(e){
    if(!e || (e && e.code === 'EEXIST')) {
      diffWatchOpts.storageDir = diffWatchOpts.storagePath;
    } else {
      util.log(colors.red(e));
      util.log(colors.red('could not check / use '+diffWatchOpts.storagePath));
    }
  });

  // ensure the DB and TMP dir exist, if not create them
  fs.mkdir(diffWatchOpts.dbPath,function(e){
    if(!e || (e && e.code === 'EEXIST')) {

      fs.mkdir(diffWatchOpts.tempPath,function(e){
        if(!e || (e && e.code === 'EEXIST')) {
          connectDb(diffWatchOpts.dbPath);
        } else {
          util.log(colors.red(e));
          util.log(colors.red('could not generate temporary dir: '+diffWatchOpts.dbPath));
        }
      });

    } else {
      util.log(colors.red(e));
      util.log(colors.red('could not connect to db: '+diffWatchOpts.dbPath));
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
  diffWatchOpts.db = db;

  var collectionStr = diffWatchOpts.workingPath.toString().toLowerCase().replace(/\W/g, '');
  diffWatchOpts.dbCollection = collectionStr;

  var project = db.project = diffWatchOpts.project = db.collection(collectionStr);
  var options = db.projectOptions = diffWatchOpts.projectOptions = db.collection(collectionStr+'_options');

  util.log(colors.green('db ready + project collection: '+collectionStr));

  function getPortStartHttp() {
    portfinder.basePort = 9000;
    portfinder.getPort(function(err, port) {
      if (err) {
        util.log(colors.red("can't get port."+err));
        return;
      }
      diffWatchOpts.httpPort = port;
      util.log(colors.gray('using http port: '+port));

      // start serving http and run the diffwatcher module
      serveHttp(port);
      run();
    });
  }

  portfinder.basePort = 9070;
  portfinder.getPort(function(err, wsPort) {
    if (err) {
      util.log(colors.red("can't get websocket port."+err));
      return;
    }

    diffWatchOpts.wsPort = wsPort;
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

function serveHttp(port)
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
        'project': diffWatchOpts.projectName,
        'wsPort': diffWatchOpts.wsPort,
        'httpPort': diffWatchOpts.httpPort,
        'db': {
          collectionName: diffWatchOpts.dbCollection,
          engine: global.engine.name
        }
      })
    }
  };

  app.use(sexstatic({ root: path.join(__dirname, 'web'), extras: extras }));
  app.use('/files', sexstatic({ root: diffWatchOpts.workingPath }));
  
  http.createServer(app).listen(port);
  // i dont have much but i take all i got
  util.log(colors.green('serving http port on http://127.0.0.1:'+port+'/'));
}
// ddd
function getSettings() {
  var obj = {
    'project': diffWatchOpts.projectName,
    'wsPort': diffWatchOpts.wsPort,
    'httpPort': diffWatchOpts.httpPort,

    'db': {
      collectionName: diffWatchOpts.dbCollection,
      engine: global.engine.name
    },

    'workingPath': diffWatchOpts.workingPath,
    'dbPath': diffWatchOpts.dbPath,
    'tempPath': diffWatchOpts.tempPath,
    'revHistory': diffWatchOpts.revHistory,
    'dbHistory': diffWatchOpts.dbHistory,
  };

  return obj;
}

// called once everything is setup.
function run()
{
  if (util.isArray(diffWatchOpts.paths))
  {
    diffwatch.info('paths overriden in config file');
  }
  else
  {
    diffWatchOpts.path = diffWatchOpts.workingPath;
  }

  global.diff_watch = new diffwatch.DiffWatcher(diffWatchOpts);
  global.diff_watch.wss = global.wss;
}

util.log(colors.white('run'));
