var debug = require('debug')('gatherbase:discover:docker');
var async = require('async');
var _ = require('lodash');
var request = require('request');

var specifyArtifact;

// API docs: https://docs.docker.com/reference/api/docker-io_api



// Helper function to handle request and errors that occur
var handleRequest = function(err, res, done) {
  if (err) {
    done(err);

    return false;
  } else if (res.statusCode !== 200) {
    var httpErr = new Error('HTTP error response ' + res.statusCode);
    httpErr.response = res;

    done(httpErr);

    return false;
  }

  return true;
};



var getRetrieveJobData = (repo, done) => {
  var repoName = repo.name || repo.repo_name;

  specifyArtifact.docker.specify('dockerhub:' + repoName, null, (err, artifactSpec) => {
    if (err) {
      console.error(err);
      return done();
    }

    var spec = artifactSpec.spec;

    var rJobData = {
      properties: spec
    };

    rJobData.properties.docker_name = spec.docker_image || spec.name;
    rJobData.properties.name = spec.docker_name + ' Docker container';
    rJobData.properties.revision = _.get(spec, 'dockerhub.tags[0].name') || 'latest';
    rJobData.properties.uris = _.compact([
      _.get(spec, 'dockerhub.web_url'),
      _.get(spec, 'dockerhub.repository_url'),
      _.get(spec, 'source_repository_url')
    ]);
    rJobData.properties.labels = [
      'Docker'
    ];
    rJobData.properties.info_url = _.get(spec, 'dockerhub.web_url') || _.get(spec, 'source_repository_url');
    //rJobData.properties.maintainer = { name: '' };
    rJobData.properties.requires = [
      {
        kind: 'host',
        label: 'Docker Engine' //TODO
      }
    ];

    rJobData.properties.description = rJobData.properties.description || repo.description || repo.short_description;
    rJobData.properties.latest = true;

    done(null, rJobData);
  });
};



module.exports = function(spec) {
  debug('new instance of DockerDiscoverer', spec);

  var obj = {};

  spec = spec || {};
  spec.config = spec.config || {};

  if (!specifyArtifact) {
    try {
      specifyArtifact = require('specify-artifact');
    } catch (err) {
      try {
        specifyArtifact = require(process.env.SPECIFY_ARTIFACT_MODULE);
      } catch (err) {
        throw new Error('cannot load specify-artifact module');
      }
    }
  }

  var baseUrl = spec.config.baseUrl || 'https://hub.docker.com/v2';
  var officialUrl = spec.config.officialUrl || baseUrl + '/repositories/library/?page=1&page_size=100';
  var searchUrl = spec.config.searchUrl || baseUrl + '/search/repositories/?page=1&page_size=100&query=';
  var searchKeywords = spec.config.searchKeywords = [
    'redis', 'mysql', 'postgres', 'mongo', 'couch', 'logstash', 'elasticsearch', 'kibana', 'memcached', 'cassandra', 'mariadb', 'rethinkdb', 'maven', 'nats', 'rabbitmq',
    'ubuntu', 'centos', 'redhat', 'debian', 'fedora',
    'go', 'golang', 'python', 'ruby', 'node', 'dart', 'java', 'php', 'rails', 'iojs', 'django',
    'apache', 'httpd', 'nginx', 'jenkins', 'haproxy', 'tomcat', 'perl',
    'wordpress', 'owncloud'
  ];
  var parallelLimit = spec.config.parallelLimit || 5;

  obj.discover = function(retrieve, log, progress, done) {
    debug('discovery initiated');

    async.series([
      function(done) {
        request.get({
          url: officialUrl,
          json: true
        }, function(err, res, results) {
          if (handleRequest(err, res, done) === false) return;

          async.eachSeries(results.results, function(repo, done) {
            getRetrieveJobData(repo, (err, rJobData) => {
              if (err || !rJobData) return done(err);

              retrieve(rJobData, done);
            });
          }, done);
        });
      },
      function(done) {
        var count = 0;

        async.eachSeries(searchKeywords, function(keyword, done) {
          count++;
          progress(count, _.size(searchKeywords) + 1);

          request.get({
            url: searchUrl + keyword,
            json: true
          }, function(err, res, results) {
            if (handleRequest(err, res, done) === false) return;

            async.eachSeries(results.results, function(repo, done) {
              getRetrieveJobData(repo, (err, rJobData) => {
                if (err || !rJobData) return done(err);

                retrieve(rJobData, done);
              });
            }, done);
          });
        }, done);
      }
    ], function(err) {
      if (!err) log(total + ' Docker containers successfully discovered');

      done(err);
    });
  };

  return obj;
};
