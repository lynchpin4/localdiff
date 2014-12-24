// more time for cleanup later

window.routes = {};
window.msgHandler = {};

window.routes['404'] = function() {
  console.log('404 page - whoops');
  location.hash = '404';
}

// recent route
window.routes['recent'] = function() {
  console.log('recent page');
  $("#recent_page").html('<p class="text-center text-info"><h4>loading recent revisions..'+'</h4></p>');
  send({cmd:'recent'});
}

// WHatever

window.msgHandler['recent'] = function(msg)
{
  window.recents = msg['files'];
  console.log('-- window.recents loaded --');

  var activeRev = window.recents.length;
  $("#files_page").html('<p class="text-center text-info"><h2>Viewing Recent Revisions</h2>(Inactive / blank revisions not shown)</p>');
  window.recents.reverse();
  window.recents.forEach(function(item, i) {
    if (item.diff == "") return;

    $('#files_page').append('<a href="#file/'+item.file+'"><h5>Re. #'+activeRev+' - '+moment(item.timestamp).fromNow()+' - '+ moment(item.timestamp).format('MMMM Do YYYY, h:mm:ss a') +'</h5></a>');

    var code = escapeHtml(item.diff); //.replace(/\n/g, '<br>');
    $('#files_page').append('<pre class="sh_diff">'+"\n"+code+"\n"+'</pre>');
    activeRev--;
  });

  sh_highlightDocument();
  $('#files_page').show();
}

// file route
window.routes['file'] = function() {
  console.log('files page');
  $("#files_page").html('<p class="text-center text-info"><h4>Loading '+fileId+'</h4></p>');
  send({cmd:'file', key: fileId});
}

window.msgHandler['file'] = function(msg)
{
  window.file = msg['file'];

  console.log('-- window.file loaded --');

  file.friendlyDate = moment(file.lastUpdate).fromNow();
  file.title = file.path + ' - ' + file.friendlyDate.toString() + ' - Changes / Revisions: '+file.revisions.length;

  var activeRev = file.revisions.length;
  $("#files_page").html('<p class="text-center text-info"><h2>Viewing '+file.title+'</h2>(Inactive / blank diffs not shown.)</p>');
  file.revisions.reverse();
  file.revisions.forEach(function(item, i) {
    if (item.diff == "") return;

    $('#files_page').append('<h5>Revision #'+activeRev+' - '+moment(item.timestamp).fromNow()+' - '+ moment(item.timestamp).format('MMMM Do YYYY, h:mm:ss a') +'</h5>');

    var code = escapeHtml(item.diff); //.replace(/\n/g, '<br>');
    $('#files_page').append('<pre class="sh_diff">'+"\n"+code+"\n"+'</pre>');
    activeRev--;
  });

  sh_highlightDocument();
  $('#files_page').show();
}


// files route
window.routes['files'] = function() {
  console.log('files page');
  $("#files_page").html('<p class="text-center text-info"><h4>Loading</h4></p>');
  send({cmd:'files'});
}

window.msgHandler['files'] = function(msg)
{
  window.files = msg['files'];
  console.log('-- window.files ('+files.length+') loaded --');
  $("#files_page").html('<p class="text-center text-info"><h4>Recently Modified Files:</h4></p>');

  window.files = window.files.map(function(item) {
    item.friendlyDate = moment(item.lastUpdate).fromNow();
    item.row = item.path + ' - ' + item.friendlyDate.toString() + ' - Changes / Revisions: '+item.revisions.length;
    return item;
  });

  files.sort(function(a, b) { return b.lastUpdate - a.lastUpdate; });
  files.forEach(function(item, i) {
    $('#files_page').append('<p><a href="#file/'+item.key+'">'+(i+1)+'. '+item.row+'</a></p>')
  });
}

window.msgHandler['refresh-watcher'] = function(msg)
{
  if ($("#auto_reload").is(":checked"))
  {
    console.log('auto refreshing (reload packet)');
    routeHandler();
  }
  else
  {
    console.log('watcher reload packet'); // ff
  }
}

function setOpts(opts)
{
  $('title').text('Localdiff: '+opts.project);
  $('.retitle').text(opts.project);
}

function connected(e)
{
  console.log('-- ws connected --');
  if (typeof(window.ws_ready) == 'function')
    window.ws_ready();
}

function routeHandler()
{
  var hash = (location.hash.replace(/^#/, ''));

  // need to start w/ current route
  window.oldRoute = window.route;

  if (hash == 'console') {
    // console
  } else if (hash == 'stats') {
    // stats
    window.route = 'construction' || 'status';
  } else if (hash == 'vars') {
    // vars + config
    window.route = 'construction' || 'vars';
  } else if (hash == 'dbcleanup') {
    // db cleanup
    window.route = 'mdbcleanup';
  } else if (hash == 'files') {
    // files
    window.route = 'files';
  } else if (hash.indexOf("file") != -1) {
    window.route = 'file';
    window.fileId = hash.split('/')[1].trim();
  } else if (hash == 'recent') {
    // recent
    window.route = 'recent';
  } else if (hash == 'revisions') {
    // recent / revisions
    window.route = 'recent';
  } else if (hash == 'saved') {
    // snippets
    window.route = 'construction' || 'saved';
  } else if (hash.length == 0 || hash.trim() == '') {
    // home
    window.route = 'home';
  }
  else
  {
    // 404 / last resort
    window.route = '404';
  }

  if (window.route != '404')
  {
    $("#alerts").html('');
    $("#alerts").show();
  }
  else
  {
    // hide alerts on 404 page, clear for any other new route
    $("#alerts").hide();
  }

  // scroll
  window.scrollTo(0,0);

  // hide the page-parts for different pages / show the current ones
  $('.page-part').hide();
  $('.page-'+window.route).show();

  if (window.routes[window.route] &&
      typeof(window.routes[window.route]) == 'function')
  {
    console.log('window route handler call: '+window.route);
    window.routes[window.route]();
  }
}

function message(e)
{
  msg = e.data;
  if (msg[0] == '{')
  {
    msg = JSON.parse(msg);

    if (msg.connected)
    {
      window.opts = msg.opts;
      setOpts(opts);
    }
    else if (typeof(window.msgHandler[msg.msg]) == 'function') { window.msgHandler[msg.msg](msg); }
    else { console.log('got message: '+e.data); }
  }
}

function closed()
{
  console.log('-- ws closed --');
  $('.navbar-form').addClass('text-danger').html('<h4>Socket Disconnected. Refresh / Restart localdiff</h4>');
}

function connect() {
  // connect to local websocket server
  window.ws = new WebSocket('ws://'+window.location.hostname+':'+wsconfig.wsPort);
  ws.onopen = connected;
  ws.onmessage = message;
  ws.onclose = closed;
}

function send(js)
{
  if (window.ws)
  {
    window.ws.send(JSON.stringify(js));
  }
  else
  {
    window.ws_ready = function() {
      send(js);
    }
  }
}

$(function(){
  window.onhashchange = routeHandler;

  $.get('ws.json', function(resp){
    console.log('got ws config: '+JSON.stringify(resp));
    window.wsconfig = resp;
    connect();
  });

  window.route = 'home';

  // initial route
  routeHandler();
});
