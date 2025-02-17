var async = require('async');
var express = require('express');
var bodyParser = require('body-parser');
var r = require('rethinkdb');

var config = require(__dirname + '/config.js');

var app = express();

//Seguridad y Login
var hash = require('pbkdf2-password')()
var path = require('path');
var session = require('express-session');
const moment = require('moment');

//For serving the index.html and all the other front-end assets.
app.use(express.static(__dirname + '/public'));

app.use(bodyParser.urlencoded({extended: true}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'public'));

app.use(session({
  resave: false, // don't save session if unmodified
  saveUninitialized: false, // don't create session until something stored
  secret: 'shhhh, very secret'
}));

//Autenticacion
app.route("")
  .get(view_login);

app.route("/login")
  .get(view_login)
  .post(login_post);
  
app.route("/logout")
  .get(logout);

app.route("/register")
  .post(register);

//Votaciones

app.route("/create-voting")
  .get(form_voting)
  .post(createVotingItem);

app.route("/voting-list")
  .get(listVotings);

app.route("/voting/:id")
  .get(votingDetail);

//Respuestas

app.route("/answer-voting")
  .post(createAnswerVoting);


//Prueba base de datos
app.route("/test-batabase")
  .get(newDatabase);
  
//If we reach this middleware the route could not be handled and must be unknown.
app.use(handle404);

//Generic error handling middleware.
app.use(handleError);

// Session-persisted message middleware

app.use(function(req, res, next){
  var err = req.session.error;
  var msg = req.session.success;
  delete req.session.error;
  delete req.session.success;
  res.locals.message = '';
  if (err) res.locals.message = '<p class="msg error">' + err + '</p>';
  if (msg) res.locals.message = '<p class="msg success">' + msg + '</p>';
  next();
});

// Authenticate using our plain-object database of doom!

function authenticate(name, pass, app, fn) {
  if (!module.parent) console.log('authenticating %s:%s', name, pass);
  var user;
  r.table('users').get(name).run(app._rdbConn, function(err, result) {
    if(err) {
      return next(err);
    }
    user = result;
    // query the db for the given username
    if (!user) return fn(null, null)
    // apply the same algorithm to the POSTed password, applying
    // the hash against the pass / salt, if there is a match we
    // found the user
    hash({ password: pass, salt: user.salt }, function (err, pass, salt, hash) {
      if (err) return fn(err);
      if (hash === user.hash) return fn(null, user)
      fn(null, null)
    });
  });
}

function is_authenticated(req) {
  if (req.session.user) {
    return true;
  } else {
    return false;
  }
}

app.get('/', function(req, res){
  res.redirect('/login');
});

function restricted(req, res){
  res.send('Wahoo! restricted area, click to <a href="/logout">logout</a>');
};

function logout(req, res){
  // destroy the user's session to log them out
  // will be re-created next request
  req.session.destroy(function(){
    res.redirect('/login');
  });
};

function view_login(req, res){
  var user = req.session.user;
  res.render('login', {user: user});
};

function login_post(req, res, next) {
  authenticate(req.body.username, req.body.password, req.app, function(err, user){
    if (err) return next(err)
    if (user) {
      // Regenerate session when signing in
      // to prevent fixation
      req.session.regenerate(function(){
        // Store the user's primary key
        // in the session store to be retrieved,
        // or in this case the entire user object
        req.session.user = user;
        req.session.success = 'Authenticated as ' + user.name
          + ' click to <a href="/logout">logout</a>. '
          + ' You may now access <a href="/restricted">/restricted</a>.';
        res.redirect('/voting-list');
      });
    } else {
      req.session.error = 'Authentication failed, please check your '
        + ' username and password.'
        + ' (use "tj" and "foobar")';
      res.redirect('/login');
    }
  });
};

function register(req, res, next) {
  var user = req.body;

  console.dir(user);

  // when you create a user, generate a salt
  // and hash the password ('foobar' is the pass here)
  var salt_user;
  var hash_user;
  hash({ password: req.body.password }, function (err, pass, salt, hash) {
    if (err) throw err;

    salt_user = salt;
    hash_user = hash;

    delete user.password;
    user.salt = salt_user;
    user.hash = hash_user;

    r.table('users').insert(user, {returnChanges: true}).run(req.app._rdbConn, function(err, result) {
      if(err) {
        return next(err);
      }
  
      res.redirect("/login");
    });    
  });
};

//Form Creacion Voting
function form_voting(req, res) {
  authenticated = is_authenticated(req);
  var user = req.session.user;
  if(authenticated){
    res.render('voting', {user: req.session.user});
  }
  else{
    res.render("login", {user: req.session.user});
  }
}

//Create Voting
function createVotingItem(req, res, next) {
  authenticated = is_authenticated(req);
  if(authenticated){
    var votingItem = req.body;

    console.dir(votingItem);
  
    r.table('votings').insert(votingItem, {returnChanges: true}).run(req.app._rdbConn, function(err, result) {
      if(err) {
        return next(err);
      }
  
      res.redirect("/voting-list");
    });
  }
  else{
    res.render("login", {user: req.body.user});
  }
}

//Answer Voting
function createAnswerVoting(req, res, next) {
  authenticated = is_authenticated(req);
  if(authenticated){
    var answerItem = req.body;
    console.dir(answerItem);

    r.table('answers').filter({usuarioid: answerItem.usuarioid, voting: answerItem.voting}).delete().run(req.app._rdbConn, function(err, resut){
      if(err){
        return next(err);
      }
    });
  
    r.table('answers').insert(answerItem, {returnChanges: true}).run(req.app._rdbConn, function(err, result) {
      if(err) {
        return next(err);
      }
  
      res.redirect('back');
    });
  }
  else{
    res.render("login", {user: req.body.user});
  }
}
//Detail of one voting
function votingDetail(req, res, next) {
  var votingId = req.params.id;

  r.table('votings').get(votingId.toString()).run(req.app._rdbConn, function(err, voting) {
    if(err) {
      return next(err);
    }
    r.table('answers').group('voting').run(req.app._rdbConn, function(err, cursor) {
      if(err){
        return next(err);
      }
      cursor.toArray(function(err, answers_grouped) {
        if(err) {
          return next(err);
        }
        
        res.render('votingdetail', {voting: voting, user:req.session.user, answers: answers_grouped});   
      });
    });
  });
}

//Retrieve all votings
function listVotings(req, res, next) {
  r.table('votings').run(req.app._rdbConn, function(err, cursor) {
    if(err) {
      return next(err);
    }    
    //Retrieve all the votings in an array.
    cursor.toArray(function(err, votings) {
      if(err) {
        return next(err);
      }
      res.render('votinglist', {votings: votings, user:req.session.user});
    });
  });
}

//Create database
function newDatabase(req, res, next) {
  var faker = require('faker');
  var moment = require('moment');
  i = 1;
  while(i<=25){
    id = i;
    var name = faker.name.firstName();
    var description = faker.lorem.words();
    var fecha = faker.date.future();
    var fecha = moment(fecha).format('YYYY-MM-DD');
    var hora = moment(fecha).format('hh:mm')

    var dic = {'id':id.toString(),'name':name,'description':description,'last_date':fecha,'last_hour':hora,'opcion':['1','2','3','4','5']}

    r.table('votings').insert(dic, {returnChanges: true}).run(req.app._rdbConn, function(err, result) {
      if(err) {
        return next(err);
      }
    });
    i++;
  }

  i = 1;
  while(i<=500){
    var username = faker.internet.userName();
    var pass = '12Pass34';
    hash({ password: pass }, function (err, pass, salt, hash) {
      if (err) throw err;
  
      var salt_user = salt;
      var hash_user = hash;

      var dic = {'username':username,'salt':salt_user,'hash':hash_user};

      r.table('users').insert(dic, {returnChanges: true}).run(req.app._rdbConn, function(err, result) {
        if(err) {
          return next(err);
        }
      });
    });

    var opciones = ['1','2','3','4','5'];
    var indiceAleatorio = Math.floor(Math.random() * opciones.length);
    var min = 1;
    var max = 25;
    var numeroAleatorio = Math.floor(Math.random()*(max-min+1)) + min;
    var dic = {'id':i.toString(),'option':opciones[indiceAleatorio],'usuarioid':username,'voting':numeroAleatorio.toString()};

    r.table('answers').insert(dic, {returnChanges: true}).run(req.app._rdbConn, function(err, result) {
      if(err) {
        return next(err);
      }
    });

    i++; 
  }
  res.redirect("/voting-list");
}
/*
 * Page-not-found middleware.
 */
function handle404(req, res, next) {
  res.status(404).end('not found');
}

/*
 * Generic error handling middleware.
 * Send back a 500 page and log the error to the console.
 */
function handleError(err, req, res, next) {
  console.error(err.stack);
  res.status(500).json({err: err.message});
}

/*
 * Store the db connection and start listening on a port.
 */
function startExpress(connection) {
  app._rdbConn = connection;
  app.listen(config.express.port);
  console.log('Listening on port ' + config.express.port);
}

/*
 * Connect to rethinkdb, create the needed tables/indexes and then start express.
 * Create tables/indexes then start express
 */
async.waterfall([
  function connect(callback) {
    r.connect(config.rethinkdb, callback);
  },
  function createDatabase(connection, callback) {
    //Create the database if needed.
    r.dbList().contains(config.rethinkdb.db).do(function(containsDb) {
      return r.branch(
        containsDb,
        {created: 0},
        r.dbCreate(config.rethinkdb.db)
      );
    }).run(connection, function(err) {
      callback(err, connection);
    });
  },
  function createUsers(connection, callback) {
    //Create the table of users if needed.
    r.tableList().contains('users').do(function(containsTable) {
      return r.branch(
        containsTable,
        {created: 0},
        r.tableCreate('users', {primary_key: "username"})
      );
    }).run(connection, function(err) {
      callback(err, connection);
    });
  },
  function createVotings(connection, callback) {
    //Create the table of votings if needed.
    r.tableList().contains('votings').do(function(containsTable) {
      return r.branch(
        containsTable,
        {created: 0},
        r.tableCreate('votings', {primary_key: "id"})
      );
    }).run(connection, function(err) {
      callback(err, connection);
    });
  },
  function createAnswers(connection, callback) {
    //Create the table of answers if needed.
    r.tableList().contains('answers').do(function(containsTable) {
      return r.branch(
        containsTable,
        {created: 0},
        r.tableCreate('answers')
      );
    }).run(connection, function(err) {
      callback(err, connection);
    });
  },
], function(err, connection) {
  if(err) {
    console.error(err);
    process.exit(1);
    return;
  }

  startExpress(connection);
});