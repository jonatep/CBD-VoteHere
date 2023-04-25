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

//The REST routes for "todos".
app.route('/todos')
  .get(listTodoItems)
  .post(createTodoItem);

app.route('/todos/:id')
  .get(getTodoItem)
  .put(updateTodoItem)
  .delete(deleteTodoItem);

//Autenticacion
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

//Respuestas

app.route("/answer-voting")
  .post(createAnswerVoting);
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
  
      res.json(result.changes[0].new_val);
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
  
      res.json(result.changes[0].new_val);
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
  
    r.table('answers').insert(answerItem, {returnChanges: true}).run(req.app._rdbConn, function(err, result) {
      if(err) {
        return next(err);
      }
  
      res.redirect("voting-list")
    });
  }
  else{
    res.render("login", {user: req.body.user});
  }
}

//Retrieve all votings
function listVotings(req, res, next) {
  res_answers = {};
  r.table('votings').run(req.app._rdbConn, function(err, cursor) {
    if(err) {
      return next(err);
    }

    //Retrieve all the votings in an array.
    cursor.toArray(function(err, result) {
      if(err) {
        return next(err);
      }

      result.forEach(function(voting) {
        r.table('answers').get(voting.id).run(req.app._rdbConn, function(err, answers) {
          cursor.toArray(function(err, answers) {
            if(err) {
              return next(err);
            }
            console.log(answers);
            res_answers[voting.id] = answers;
          });

        });
      });
      console.log(res_answers);
      res.render('votinglist', {votings: result, user:req.session.user, answers: res_answers});
    });
  });
}


/*
 * Retrieve all todo items.
 */
function listTodoItems(req, res, next) {
  r.table('todos').orderBy({index: 'createdAt'}).run(req.app._rdbConn, function(err, cursor) {
    if(err) {
      return next(err);
    }

    //Retrieve all the todos in an array.
    cursor.toArray(function(err, result) {
      if(err) {
        return next(err);
      }

      res.json(result);
    });
  });
}

/*
 * Insert a new todo item.
 */
function createTodoItem(req, res, next) {
  var todoItem = req.body;
  todoItem.createdAt = r.now();

  console.dir(todoItem);

  r.table('todos').insert(todoItem, {returnChanges: true}).run(req.app._rdbConn, function(err, result) {
    if(err) {
      return next(err);
    }

    res.json(result.changes[0].new_val);
  });
}

/*
 * Get a specific todo item.
 */
function getTodoItem(req, res, next) {
  var todoItemID = req.params.id;

  r.table('todos').get(todoItemID).run(req.app._rdbConn, function(err, result) {
    if(err) {
      return next(err);
    }

    res.json(result);
  });
}

/*
 * Update a todo item.
 */
function updateTodoItem(req, res, next) {
  var todoItem = req.body;
  var todoItemID = req.params.id;

  r.table('todos').get(todoItemID).update(todoItem, {returnChanges: true}).run(req.app._rdbConn, function(err, result) {
    if(err) {
      return next(err);
    }

    res.json(result.changes[0].new_val);
  });
}

/*
 * Delete a todo item.
 */
function deleteTodoItem(req, res, next) {
  var todoItemID = req.params.id;

  r.table('todos').get(todoItemID).delete().run(req.app._rdbConn, function(err, result) {
    if(err) {
      return next(err);
    }

    res.json({success: true});
  });
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
  function createTable(connection, callback) {
    //Create the table if needed.
    r.tableList().contains('todos').do(function(containsTable) {
      return r.branch(
        containsTable,
        {created: 0},
        r.tableCreate('todos')
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
        r.tableCreate('votings')
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
        r.tableCreate('answers', {primary_key: "voting"})
      );
    }).run(connection, function(err) {
      callback(err, connection);
    });
  },
  function createIndex(connection, callback) {
    //Create the index if needed.
    r.table('todos').indexList().contains('createdAt').do(function(hasIndex) {
      return r.branch(
        hasIndex,
        {created: 0},
        r.table('todos').indexCreate('createdAt')
      );
    }).run(connection, function(err) {
      callback(err, connection);
    });
  },
  function waitForIndex(connection, callback) {
    //Wait for the index to be ready.
    r.table('todos').indexWait('createdAt').run(connection, function(err, result) {
      callback(err, connection);
    });
  }
], function(err, connection) {
  if(err) {
    console.error(err);
    process.exit(1);
    return;
  }

  startExpress(connection);
});