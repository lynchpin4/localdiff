var util = require('util'),
    chokidar = require('chokidar'),
    colors = require('colors'),
    fs = require('fs'),
    path = require('path'),
    /* classes / static imports */
    exec = require('child-process-promise').exec,
    spawn = require('child-process-promise').spawn,
    EventEmitter = require('events').EventEmitter;

var dw = require('./modules/utils'),
    localdiff = require('./modules/localdiff');

var diff = localdiff.diff;

// an eventemitter, diffwatch is the module containing the logic for updating the mongodb-compatible tingodb setup by index.js
// and creating the relevant collections for the path.
function diffwatch(opts)
{
  this.path = opts.workingPath;
  this.db = opts.db;
  this.storage = opts.storageDir.toLowerCase();
  this.dbPath = opts.dbPath.toLowerCase();

  this.project = opts.project;
  this.revHistory = opts.revHistory;
  this.dbHistory = opts.dbHistory;

  // ready / scanned working dir
  this.ready = false;

  // current list of revisions made this session
  this.revisions = [];

  dw.current = this;
  localdiff.tempDir = opts.tempPath;
  localdiff.getDiffPath(function(){
    dw.debug('starting diffwatch');
    this.start();
  }.bind(this));
}
diffwatch.prototype.__proto__ = EventEmitter.prototype;

// important - the class gets exposed here
dw.DiffWatcher = diffwatch;

// start watching
diffwatch.prototype.start = function() {
  var watcher = this.watcher = chokidar.watch(this.path, {ignored: /[\/\\]\./, persistent: true});
  watcher.on('ready', function() {
    util.log('Scanned working directory. ready for changes..');
    this.ready = true;
    this.check();
  }.bind(this));
}

diffwatch.prototype.getFiles = function(msg, send)
{
  send({ msg: 'incoming_files' });
  var project = this.project;
  project.find().toArray(function (err, result) {
    send({
      msg: 'files',
      files: result
    })
  });
}

diffwatch.prototype.getFile = function(msg, send)
{
  send({ msg: 'incoming_file' });
  var project = this.project;
  project.findOne({ key: msg.key }, function (err, result) {
    send({
      msg: 'file',
      file: result
    })
  });
}

diffwatch.prototype.getRecent = function(msg, send)
{
  send({ msg: 'incoming_recent' });
  var project = this.project;
  project.findOne({ key: msg.key }, function (err, result) {
    send({
      msg: 'recent',
      files: this.revisions.slice(-100)
    })
  }.bind(this));
}

diffwatch.prototype.clientCmd = function(msg, send)
{
  dw.debug('diffwatcher ws:', JSON.stringify(msg));

  // send the most recent changes, up to limit or default 25
  if (msg.cmd == "recent")
  {
    this.getRecent(msg, send);
  }

  if (msg.cmd == "file")
  {
    this.getFile(msg, send);
  }

  if (msg.cmd == "files")
  {
    this.getFiles(msg, send);
  }

  if (msg.cmd == "ping")
    send({msg: 'pong'});
}

var originals = {};

// update block to be called after saving other info
diffwatch.prototype.update = function update(obj, record, oneId) {
  // update debug (test)
  dw.debug('updating id '+oneId, 'type of ',typeof(oneId));
  dw.debug('update diff length: ', obj.diff.length);

  var project = this.project,
      scope = this;

  // try and update this with set first
  project.update({ _id: oneId }, {
    "$set": {
      previous: obj.text.toString('base64'),
      lastUpdate: new Date().getTime()
    }
  });

  // see how that is
  project.update(
  { _id: oneId },
  {
    key: obj.key,
    $push: { revisions: record }
  },
  function(err, result) {
    if (err != null) {
      dw.error('error saving to db', err);
      dw.error(err.stack);
    }

    // add the last revision onto the session stack.
    var revRec = record;
    revRec.file = obj.key;

    scope.revisions.push(revRec);

    // check to make sure the revision saved correctly (ensure-write)
    project.findOne({ _id: oneId }, function(err, entry){
      // check for error
      if (err != null)
      {
        dw.error(err);
        dw.error(err.stack);
        return;
      }

      // make sure entry is there / updated test
      if (entry != null && entry.revisions != null)
      {
        // show entry info / test debug
        var lastDiff = entry.revisions[entry.revisions.length-1].diff || null;
        dw.info("revision history for "+oneId+" contains "+entry.revisions.length+" entries.");
        dw.debug('updated diff length: ', lastDiff.length);
        dw.debug('last diff: ', lastDiff);
      }
      else if (entry != null)
      {
        dw.error('revision history for '+oneId+' null');
      }
      else
      {
        dw.error('revision history / entry for '+oneId+' null');
      }
    });
  }); // update callback (first)
} // fn:update

// start listening to change events (called after ready)
diffwatch.prototype.check = function() {
  // closure / this scope
  var scope = this;
  var db = scope.db;

  this.watcher.on('change', function(file, stats) {
    if (file.indexOf('temp') != -1) return;

    var name = file.toLowerCase();
    if ((name.indexOf('.localdiff') != -1) || (file.indexOf('db') != -1) || (file.indexOf('storage') != -1) || (name.indexOf(this.storage) != -1) || (file.indexOf(name.dbPath) != -1)) {
      dw.debug('file updated in internal dirs. ignoring');
      return;
    }

    dw.debug('File', file, 'changed size to', stats.size);

    // auto reload watcher (test)
    setTimeout(function() { if (this.wss) this.wss.broadcast({msg: 'refresh-watcher'}); }.bind(this), 1200);

    var key = (file+'').toLowerCase().replace(/\W/g, '').toString();
    var project = this.project;

    // find existing record by key in db
    this.project.findOne({ key: key }, function(err, item){
      if (err)
      {
        dw.error('db', err);
        dw.error('stack', err.stack);
        dw.info('key:', key);
        return;
      }

      if (item == null) {
        dw.debug('no item found for key:', key);

        if (originals[key])
        {
          // if we have the original state of the file
          // and it's changed, diff from that
          diff(file, originals[key], function(success, obj){
            if (success)
            {
              // create the mew revision record
              var record = { timestamp: new Date().getTime(), diff: obj.diff };

              project.insert({
                key: obj.key,
                path: file,
                lastUpdate: new Date().getTime(),
                revisions: [ record ],

                previous: obj.text.toString('base64'),
              });

              dw.success('tracking new file '+file);
            }
            else
            {
              dw.warn('original diff failed for '+file+" info: "+JSON.stringify(obj));
            }
          });

          return;
        }
        else
        {
          dw.info('will track '+file+' on next change (waiting for new version)');
          originals[key] = fs.readFileSync(file);

          return;
        }

        dw.error('diff could not find item w/ key:'+key+' for file:'+file+' / did nothing about it.');
        return;
      }

      // updated
      if (item != null && item.previous)
      {
        var oneId = item._id;
        dw.debug('existing item key: ', item.key, ' id:', oneId);

        //dw.debug('item id:', oneId);
        //dw.debug('running diff for '+file+' / key '+item.key);

        // file has a latest version stored in the db, so diff against that and save result
        // at this point, latest should be the last revision
        diff(file, new Buffer(item.previous, 'base64'), function(success, obj){
          // update
          if (success)
          {
            // wtf, why wouldn't item b here
            dw.debug('got new diff for '+file+' with id '+oneId);

            var record = { timestamp: new Date().getTime(), diff: obj.diff };
            if (scope.dbHistory)
            {
               dw.debug('saving history in DB for', oneId)
               record.text = obj.text;
            }

            // if we are using revision history, move the tmp file to storage - then call update, or call update when
            // finished.
            if (scope.revHistory)
            {
              // base path (ie folder name without extension)
              record.saved_at = path.join(scope.storage, path.basename(file, path.extname(file))+'-revs');

              // create the revisions folder
              fs.mkdir(record.saved_at,function(e){
                if(!e || (e && e.code === 'EEXIST')) {
                  record.saved_at = path.join(record.saved_at, path.basename(file, path.extname(file))+'('+record.timestamp+')'+path.extname(file));
                  try {
                    fs.renameSync(obj.tmp, record.saved_at);
                    dw.success('saved revision file '+record.saved_at);

                    scope.update(obj, record, oneId);
                  } catch (ex) {
                    dw.error(ex, 'while saving revision file');
                    // scope.update(obj, record, oneId);
                  }
                }
                else
                {
                  dw.error(e);
                  dw.warn('could not check / use '+record.saved_at+'.. did not save revision file!');
                  // scope.update(obj, record, oneId);
                }
              })
            }
            else
            {
              // no file based revision history
              scope.update(obj, record, oneId);
            }

          }
          else
          {
            // diff was not successful - why
            dw.error('diff unsuccessful - from diff engine: ');
            dw.warn(JSON.stringify(obj));
          }
        }.bind(this));
      }

    }.bind(this)); /* findOne */
  }.bind(this)); /* change */

  dw.info('started checking');
}

module.exports = dw;
