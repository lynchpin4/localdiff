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
  this.storage = opts.storageDir;
  this.project = opts.project;
  this.revHistory = opts.revHistory;

  this.ready = false;

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

var originals = {};

// ready check (10-4)
diffwatch.prototype.check = function() {
  // closure / this scope
  var scope = this;
  var db = scope.db;

  this.watcher.on('change', function(file, stats) {
    if (file.indexOf('temp') != -1) return;
    if (file.indexOf('db') != -1) return;
    if (file.indexOf('storage') != -1) return;

    dw.debug('File', file, 'changed size to', stats.size);

    var key = (file+'').toLowerCase().replace(/\W/g, '').toString();
    var project = this.project;

    // find existing record by key in db
    this.project.findOne({ key: key }, function(err, item){
      // hmm
      if (err)
      {
        dw.error('db', err);
        dw.error('stack', err.stack);
        dw.info('key:', key);
        return;
      }

      if (!item || !item.lastDiff) {
        if (originals[key])
        {
          // if we have the original state of the file
          // and it's changed, diff from that
          diff(file, originals[key], function(success, obj){
            if (success)
            {
              project.insert({
                key: obj.key,
                path: obj.path,
                lastUpdate: new Date().getTime(),
                revisions: [ obj ],

                previous: obj.previous,
                lastDiff: obj.diff,
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

        return;
      }

      // updated (once)
      if (item.lastDiff)
      {
        dw.debug('has diff saved under: ', item.key);

        var oneId = oneId || new db.engine.ObjectID(item._id);
        dw.debug('item id:', oneId);

        // file has a latest version stored in the db, so diff against that and save result
        // at this point, latest should be the last revision
        diff(file, new Buffer(item.previous || ""), function(success, obj){
          // update
          if (success)
          {
            dw.info('got new diff for '+file);

            var record = { timestamp: new Date().getTime(), diff: obj.diff };

            // big update block to be called later
            function update()
            {
              project.update(
                { _id: oneId },
                {
                  $push: { revisions: record }
                },
                function(err, result) {
                  if (err != null)
                    console.warn(err);

                  project.update(
                    { _id: oneId },
                    {
                      previous: obj.latest,
                      lastDiff: obj.diff,
                      lastUpdate: new Date().getTime()
                    }, function(err, result) {
                      if (err != null)
                        console.warn(err);

                        project.findOne({ _id: oneId }, function(err, item){
                          if (err != null)
                            console.warn(err);
                          dw.success("revision history: "+item.revisions.length+" entries. last diff:");
                          dw.info(JSON.stringify(item.lastDiff));
                        });
                    });


                }
              );
            }

            // if we are using revision history, move the tmp file to storage
            if (scope.revHistory)
            {
              // base path (ie folder name without extension)
              record.saved_at = path.join(scope.storage, path.basename(file, path.extname(file))+'-revs');

              fs.mkdir(record.saved_at,function(e){
                if(!e || (e && e.code === 'EEXIST')) {
                  record.saved_at = path.join(record.saved_at, record.timestamp+'-'+path.extname(file)+'1');
                  try {
                    fs.renameSync(obj.tmp, record.saved_at);
                    dw.success('saved revision file '+record.saved_at);
                    update();
                  } catch (ex) {
                    util.log(colors.yellow(ex));
                    update();
                  }
                } else {
                  util.log(colors.yellow(e));
                  util.log(colors.yellow('could not check / use '+record.saved_at+'.. did not save revision file!'));
                  update();
                }
              })
            }
            else
            {
              update();
            }


          }
          else
          {
            dw.warn(JSON.stringify(obj));
          }
        }.bind(this));
      }

    }.bind(this)); /* findOne */
  }.bind(this)); /* change */

  dw.info('started checking');
}

module.exports = dw;
