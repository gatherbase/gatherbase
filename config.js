var filenamify = require('filenamify');

var exportPath = process.env.GATHERBASE_EXPORT_PATH || __dirname + '/../devopsbase/gathered'; // '/_crawled'

module.exports = {
  port: 3000,
  parallelDiscoverJobs: 2,
  parallelRetrieveJobs: 3,
  parallelHandleJobs: 6,
  jobAttempts: 3,
  removeCompletedJobs: true,
  removalDelay: 1000 * 60 * 5, // 5 min
  rediscovery: false,

  discoverers: [
    {
      name: 'Chef Supermarket Discovery',
      //impl: require(__dirname + '/../gatherbase-chef').ChefDiscoverer,
      impl: require(__dirname + '/lib/discover/ChefDiscoverer'),
      config: {
        exclude: {
          application_nodejs: [ '2.0.0' ],
          wemux: [ '0.1.0' ],
          'magento-toolbox': [ '0.0.1' ],
          apache_vhosts: [ '20140108' ],
          httplivestreamsegmenter: [ '0.0.2' ],
          hollandbackup: [ '0.0.2' ],
          zabbix_windows: [ '0.0.1' ],
          windows_print: [ '0.1.0' ],
          windirstat: [ '1.0.0' ],
          system: [ '0.3.2' ],
          serf: [ '0.1' ],
          pinba: [ '0.1.0' ],
          'php-box': [ '0.0.1' ],
          phing: [ '0.0.1' ],
          'getting-orche': [ '0.4.0' ],
          'magento-toolbox': [ '0.0.1' ],
          cloudpassage: [ '0.0.2' ],
          application_zf: [ '0.0.3', '0.0.4', '0.0.5' ],
          collectd: [ '1.0.0' ]
        }
      },
      transform: function(jobData) {
        jobData.properties.gatherbase_origin = 'chef-supermarket';

        return jobData;
      }
    },
    {
      name: 'Juju Charm Store Discovery',
      impl: require(__dirname + '/lib/discover/JujuDiscoverer'),
      transform: function(jobData) {
        jobData.properties.gatherbase_origin = 'juju-charmstore';

        return jobData;
      }
    },
    {
      name: 'Ubuntu Cloud Image Discovery',
      impl: require(__dirname + '/lib/discover/UbuntuDiscoverer'),
      transform: function(jobData) {
        jobData.properties.gatherbase_origin = 'ubuntu-cloud-image-locator';

        return jobData;
      }
    },
    {
      name: 'Docker Hub Discovery',
      impl: require(__dirname + '/lib/discover/DockerDiscoverer'),
      transform: function(jobData) {
        jobData.properties.gatherbase_origin = 'docker-hub';

        return jobData;
      }
    }
  ],

  handlers: [
    {
      name: 'Chef Handler',
      impl: require(__dirname + '/lib/handle/ChefHandler'),
      select: function(jobData) {
        if (jobData.properties.gatherbase_origin === 'chef-supermarket') {
          return 1;
        }

        return false;
      }
    },
    {
      name: 'String Match-based Classification',
      impl: require(__dirname + '/lib/handle/StringMatchClassifier'),
      select: function(jobData) { return 100; },
      config: {
        taxonomyKeywords: require(__dirname + '/../devopsbase/build/taxonomy_keywords.json'),
      }
    },
    {
      name: 'File Export',
      impl: require(__dirname + '/lib/handle/FileExporter'),
      select: function(jobData) { return 200; },
      config: function(jobData) {
        var c = { format: 'json' };

        var dir = exportPath;

        //var suffix = jobData.properties.name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

        if (jobData.properties.gatherbase_origin === 'chef-supermarket') {
          c.path = dir + '/chef_supermarket/' + filenamify(jobData.properties.chef_cookbook_name); //suffix.substr(0, 3) + '.yml';
        } else if (jobData.properties.gatherbase_origin === 'juju-charmstore') {
          c.path = dir + '/juju_charmstore/' + filenamify(jobData.properties.juju_charm_name);
        } else if (jobData.properties.gatherbase_origin === 'ubuntu-cloud-image-locator') {
          c.path = dir + '/ubuntu/' + filenamify(jobData.properties.ubuntu_image_provider);
        } else if (jobData.properties.gatherbase_origin === 'docker-hub') {
          c.path = dir + '/docker_hub/' + filenamify(jobData.properties.docker_name);
        } else {
          c.path = dir + '/others';
        }

        c.path += '__' + filenamify(jobData.properties.revision);
        if (jobData.properties.latest) c.path += '__latest';
        c.path += '.' + c.format;

        return c;
      }
    }
  ],

  retriever: { //TODO: allow inclusion of custom retrievers to support proprietary protocols; use select functions as used for handlers
    destination: __dirname + '/_temp'
  },

  /*status: {
    redis: {
      db: 5
    }
  },*/

  queue: {
    prefix: 'gatherbase',
    disableSearch: false,
    redis: {
      port: 6379,
      host: '127.0.0.1',
      //auth: 'password',
      db: 3,
      options: {
        // https://github.com/mranney/node_redis
      }
    }
  }
}
