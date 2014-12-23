// all the project requirements
//var Engine = require('tingodb')(),
var path = require('path'),
assert = require('assert'),
fs = require('fs'),
util = require('util'),
chokidar = require('chokidar'),
colors = require('colors'),
/* another lib i wanna extend right here - baseport needn't be a single one, yadidimean? */
portfinder = require('portfinder');

/* the custom diffwatch lib we write for this project */
var diffwatch = require('./diffwatch').DiffWatcher;

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

//util.log(argv.dir);
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


fs.mkdir(DATA_DIR,function(e){
  if(!e || (e && e.code === 'EEXIST')) {
    makeInnerDirs();
  } else {
    util.log(colors.red(e));
    util.log(colors.red('could not check / use '+STORAGE_DIR));
  }
});

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
    return db;
  } else {
    util.log(colors.gray('using tingodb'));
    global.engine = require("tingodb")({});
    var db;
    if (!db) db = new engine.Db(dir, {});
    db.engine = global.engine;
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
  global.diffWatchOpts.colletion = collectionStr;

  var project = db.project = global.diffWatchOpts.project = db.collection(collectionStr);
  var options = db.projectOptions = global.diffWatchOpts.projectOptions = db.collection(collectionStr+'_options');

  util.log(colors.green('db ready + project collection: '+collectionStr));

  // todo: count / save to db
  var trackedCount = 0;

  portfinder.basePort = 9000;
  portfinder.getPort(function(err, port) {
    if (err) {
      util.log(colors.red("can't get port."+err));
      return;
    }
    global.httpPort = port;
    util.log(colors.gray('using http port: '+port));

    serveHttp(WORKING_DIR, port);
    run();
  });

  /*
  collection.find({hello:'world_safe2'}).toArray(function(err, item) {
    util.log('----');
    console.dir(item);
  });

  collection.insert([{a:1, b:1}, {a:2, b:2}, {a:3, b:3}], {w:1}, function(err, result) {
  assert.equal(null, err);
  );
  */
}

function serveHttp(path, port)
{
  var http = require('http');
  var express = require('express');
  var sexstatic = require('sexstatic');

  var app = express();
  app.use(sexstatic({ root: path }));
  http.createServer(app).listen(port);

  util.log(colors.green('serving http port on http://127.0.0.1:'+port+'/'));
}

// called once everything is setup.
function run()
{
  global.diff_watch = new diffwatch(global.diffWatchOpts);
}

util.log(colors.white('run'));
