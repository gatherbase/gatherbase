var kue = require('kue');
var _ = require('lodash');
var async = require('async');
//var url = require('url');
var debug = require('debug')('gatherbase:server');
var log = require('verr-log')();
var VError = require('verror');
var domain = require('domain');

//var Status = require('./Status');
var Retriever = require('./retrieve/Retriever');
var CleanupHandler = require('./handle/CleanupHandler');



//TODO set time to live for each job:
// queue.create('email', {title: 'email job with TTL'}).ttl(milliseconds).save();



module.exports = function(spec) {
  debug('new instance of Server', spec);

  var obj = {};

  var config = spec || {};

  config.parallelDiscoverJobs = config.parallelDiscoverJobs || 2;
  config.parallelRetrieveJobs = config.parallelRetrieveJobs || 3;
  config.parallelHandleJobs = config.parallelHandleJobs || 6;
  config.removalDelay = config.removalDelay || 0;
  config.jobAttempts = config.jobAttempts || 5;
  config.rediscoveryDelay = config.rediscoveryDelay || 1000 * 60 * 60; // 1 hour

  config.discoverers = config.discoverers || [];
  config.handlers = config.handlers || [];
  config.retriever = config.retriever || {};
  config.queue = config.queue || {};
  //config.status = config.status || {};



  //var status = Status(config.status);

  obj.kue = kue;



  // Logging and error handling
  obj.log = log;

  process.on('uncaughtException', function(err) {
    log.error(err);

    process.exit(1);
  });



  var finalizeJob = function(err, job, callback) {
    if (!err) return callback();

    err = new VError(err, 'job error');

    err.job = job;

    log.error(err);

    var h = CleanupHandler();

    h.handle(job.data, _.bind(job.log, job), _.bind(job.progress, job), function(err2) {
      log.error(err2);

      if (!job.data.properties || _.isEmpty(job.data.properties.uris)) return callback(err);

      var primaryUri = _.first(job.data.properties.uris);

      //status.setStatus(primaryUri, job.data.properties.revision, 'error', function(err3) {
      //  log.error(err3);
      callback(err);
      //});
    });

    return err;
  };

  var createJobDomain = function(job, callback) {
    var d = domain.create();

    d.on('error', function(err) {
      finalizeJob(new VError(err, 'job domain error'), job, callback);
    });

    return d;
  };



  // Helper function to create DISCOVER jobs
  var createDiscoverJob = function(jobData, queue) {
    jobData.title = jobData.discoverer;

    var job = queue.create('Discover', jobData);

    job.on('complete', function(result) {
      debug('DISCOVER job completed', result, job.id, job.data);

      if (config.rediscovery) {
        createDiscoverJob(jobData, queue).delay(config.rediscoveryDelay).save(function(err) {
          log.error(err);
        });
      }
    }).on('failed attempt', function() {
      debug('DISCOVER job failed, but has remaining attempts', job.id, job.data);
    }).on('failed', function() {
      debug('DISCOVER job failed', job.id, job.data);
    });

    return job.attempts(config.jobAttempts).backoff(true);
  };

  // Helper function to create RETRIEVE jobs
  var createRetrieveJob = function(jobData, queue) {
    jobData.title = jobData.properties.name + ', revision ' + jobData.properties.revision;
    if (!jobData.config || _.isEmpty(jobData.config.retrieve_urls)) jobData.title += ': skip';
    else if (!_.isEmpty(jobData.properties.uris)) jobData.title += ': ' + _.first(jobData.properties.uris) + ' ...';

    var job = queue.create('Retrieve', jobData);

    job.on('complete', function(result) {
      debug('RETRIEVE job completed', result, job.id, job.data);
    }).on('failed attempt', function() {
      debug('RETRIEVE job failed, but has remaining attempts', job.id, job.data);
    }).on('failed', function() {
      debug('RETRIEVE job failed', job.id, job.data);
    });

    return job.attempts(config.jobAttempts).backoff(true);
  };

  // Helper function to create HANDLE jobs
  var createHandleJob = function(jobData, queue) {
    jobData.title = jobData.properties.name + ', revision ' + jobData.properties.revision;

    var job = queue.create('Handle', jobData);

    job.on('complete', function(result) {
      debug('HANDLE job completed', result, job.id, job.data);
    }).on('failed attempt', function() {
      debug('HANDLE job failed, but has remaining attempts', job.id, job.data);
    }).on('failed', function() {
      debug('HANDLE job failed', job.id, job.data);
    });

    return job.attempts(config.jobAttempts).backoff(true);
  };



  obj.start = _.bind(function() {
    debug('server start', config);

    // Create queue
    var queue = obj.queue = kue.createQueue(config.queue);

    // Application settings (express4 app options)
    kue.app.set('title', 'GatherBase');
    kue.app.listen(process.env.PORT || config.port || 3000);
    //kue.app.use(express.favicon(path.join(__dirname, 'public', 'images', 'favicon.ico')));

    // Additional kue-ui
    var ui = require('kue-ui');
    ui.setup({
      apiURL: '/.', // kue route
      baseURL: '/ui', // kui-ui route
      updateInterval: 3000
    });
    //kue.app.use('/api', kue.app);
    kue.app.use('/ui', ui.app);

    // Graceful shutdown
    process.once('SIGTERM', function(sig) {
      queue.shutdown(function(err) {
        log.info('Kue is shut down');

        log.error(err);

        process.exit(0);
      }, 5000);
    });

    var discoverersByName = {};

    _.each(config.discoverers, function(d) {
      if (!d.name || !d.impl) return log.error(new Error('discoverer name or implementation missing: ' + JSON.stringify(d)));

      discoverersByName[d.name] = d;
    });

    // Schedule repeated execution of discoverers
    //TODO run this at regular interval to check if there is a job for each discoverer! -> IFF config.rediscovery === TRUE
    _.each(discoverersByName, function(discoverer, name) {
      var job = createDiscoverJob({
        discoverer: name,
        config: discoverer.config
      }, queue);

      job.save(function(err) {
        if (err) return log.error(err);

        debug('new DISCOVER job', job.id, job.data);
      });
    });

/*
    // Load discoverer and handler modules
    var discoverers = {};
    var handlers = {};

    _.each(config.discoverers, function(d) {
      if (!d.name || !d.discoverer) return log.error(new Error('discoverer name or module missing: ' + JSON.stringify(d)));

      discoverers[d.name] = d.discoverer;
    });

    _.each(config.handlers, function(h) {
      if (!d.name || !d.handler) return log.error(new Error('handler name or module missing: ' + JSON.stringify(h)));

      handlers[d.name] = d.handler;
    });

    var modules = [];

    async.eachSeries(modules, function(m, callback) {
      var d = domain.create();

      d.on('error', function(err) {
        err = new VError(err, m.type + ' module domain error');

        err.module = m;

        //TODO: the following is a workaround because 'throw err;' doesn't exit the process. No idea why...

        log.error(err);

        process.exit(1);
      });

      d.run(function() {
        if (m.type === 'discoverer') discoverers[m.name] = require(m.module);
        else if (m.type === 'handler') handlers[m.name] = require(m.module);

        debug(m.type + ' loaded', m.name);

        d.exit();

        callback();
      });
    }, function(err) {
      if (err) throw err;

      // Schedule repeated execution of discoverers
      //TODO: run this at regular interval to check if there is a job for each discoverer! -> IFF config.rediscovery === TRUE
      _.each(discoverers, function(discoverer, name) {
        var job = createDiscoverJob({
          discoverer: name,
          config: config.discoverers[name].config
        }, queue);

        job.save(function(err) {
          if (err) return log.error(err);

          debug('new DISCOVER job', job.id, job.data);
        });
      });
    });
*/



    // Process DISCOVER jobs
    queue.process('Discover', config.parallelDiscoverJobs, function(dJob, done) {
      debug('processing DISCOVER job', dJob.id, dJob.data);

      done = _.once(done);

      createJobDomain(dJob, done).run(function() {
        var transform = discoverersByName[dJob.data.discoverer].transform;

        var d = discoverersByName[dJob.data.discoverer].impl({ config: dJob.data.config });

        d.discover(function(rJobData, callback) {
          //status.getStatus(_.first(rJobData.properties.uris), rJobData.properties.revision, function(err, s) {
          //  if (err) return callback(err);
          //  if (_.first(rJobData.properties.revision) !== 'latest' && s && s !== 'error') return callback();

          //rJobData.uris = rJobData.uris || {};
          rJobData.properties = rJobData.properties || {};
          rJobData.discoverer = dJob.data.discoverer;

          if (transform) rJobData = transform(rJobData);

          var rJob = createRetrieveJob(rJobData, queue);

          rJob.save(function(err) {
            log.error(err);

            if (err) return callback(err);

            debug('new RETRIEVE job', rJob.id, rJob.data);

            callback();
          });
          //});
        }, _.bind(dJob.log, dJob), _.bind(dJob.progress, dJob), function(err) {
          finalizeJob(err, dJob, done);
        });
      });
    });

    // Process RETRIEVE jobs
    queue.process('Retrieve', config.parallelRetrieveJobs, function(rJob, done) {
      debug('processing RETRIEVE job', rJob.id, rJob.data);

      done = _.once(done);

      createJobDomain(rJob, done).run(function() {
        var r = Retriever({ config: config.retriever });

        r.retrieve(rJob.data, _.bind(rJob.log, rJob), _.bind(rJob.progress, rJob), function(err, hJobData) {
          if (err) return finalizeJob(err, rJob, done);

          //hJobData.uris = rJob.data.uris;
          hJobData.properties = rJob.data.properties;

          var hJob = createHandleJob(hJobData, queue);

          hJob.save(function(err) {
            if (err) return finalizeJob(err, rJob, done);

            debug('new HANDLE job', hJob.id, hJob.data);

            done();
          });
        });
      });
    });

    // Process HANDLE jobs
    queue.process('Handle', config.parallelHandleJobs, function(hJob, done) {
      debug('processing HANDLE job', hJob.id, hJob.data);

      done = _.once(done);

      createJobDomain(hJob, done).run(function() {
        var hJobData = hJob.data;

        var selectedHandlers = [];

        _.each(config.handlers, function(handler) {
          var result = handler.select(hJobData);

          if (result === true || _.isNumber(result)) {
            var conf = handler.config;

            if (_.isFunction(conf)) conf = conf(hJob.data);
            else conf = _.cloneDeep(conf);

            _.merge(conf || {}, hJob.data.config);

            var priority = result;

            if (!_.isNumber(priority)) priority = 0;

            selectedHandlers.push({ impl: handler.impl, priority: priority, name: handler.name, config: conf });
          }
        });

        selectedHandlers = _.sortBy(selectedHandlers, 'priority');

        if (_.isEmpty(selectedHandlers)) {
          return finalizeJob(new Error('no handlers found to handle this job'), hJob, done);
        }

        selectedHandlers.push({ impl: CleanupHandler, name: 'cleanup-handler', config: {
          base: hJobData.base,
          dirs: _.cloneDeep(hJobData.dirs),
          files: _.cloneDeep(hJobData.files)
        } });

        async.eachSeries(selectedHandlers, function(handler, callback) {
          hJob.log('using handler ' + handler.name + ' with config ' + JSON.stringify(handler.config));

          var h = handler.impl({ config: handler.config });

          h.handle(hJobData, _.bind(hJob.log, hJob), _.bind(hJob.progress, hJob), function(err, hJobDataUpd) {
            if (err) return callback(err);

            if (hJobDataUpd) hJobData = hJobDataUpd;

            callback();
          });
        }, function(err) {
          finalizeJob(err, hJob, done);
        });
      });
    });



    // Auto-remove completed jobs
    if (config.removeCompletedJobs) {
      queue.on('job complete', function(id, result) {
        kue.Job.get(id, function(err, job) {
          if (err) return log.error(new VError(err, 'job ' + _.get(job, 'id') + ' completed but cannot be accessed for auto-remove'));

          setTimeout(function() {
            job.remove(function(err) {
              if (err) return log.error(new VError(err, 'cannot auto-remove job ' + job.id));

              debug('auto-removed completed job', job.id);
            });
          }, config.removalDelay);
        });
      });
    }

  }, obj);

  return obj;
};
