var debug = require('debug')('gatherbase:handle:chef');
var path = require('path');
var fs = require('fs');
var _ = require('lodash');



module.exports = function(spec) {
  debug('new instance of ChefHandler', spec);

  var obj = {};

  spec = spec || {};
  spec.config = spec.config || {};

  obj.handle = function(hJobData, log, progress, done) {
    hJobData.properties.labels = hJobData.properties.labels || [];

    hJobData.properties.labels.push('Executable/Script/Chef Cookbook');

    var readmeFile = path.join(hJobData.base, _.first(hJobData.dirs).name, 'README.md');

    if (fs.existsSync(readmeFile)) hJobData.properties.readme_name = 'README.md';

    var metadataFile = path.join(hJobData.base, _.first(hJobData.dirs).name, 'metadata.json');

    if (!fs.existsSync(metadataFile)) {
      //TODO: generate metadata.json from metadata.rb file, if JSON variant doesn't exist using the following command: knife cookbook metadata mysql -o /cookbooks

      return done(new Error('file ' + metadataFile + ' does not exist'));
    }

    var metadata = JSON.parse(fs.readFileSync(metadataFile));

    if (!_.isEmpty(metadata.maintainer_email)) {
      hJobData.properties.maintainer = hJobData.properties.maintainer || {};

      hJobData.properties.maintainer.email = metadata.maintainer_email;
    }

    if (!_.isEmpty(metadata.long_description)) {
      hJobData.properties.readme = metadata.long_description;
    }

    _.each(metadata.platforms, function(version, name) {
      hJobData.properties.requires = hJobData.properties.requires || [];

      hJobData.properties.requires.push({
        kind: 'host',
        label: name,
        revision: version,
        one_of_group: 'os'
      });
    });

    _.each(metadata.dependencies, function(version, name) {
      hJobData.properties.requires = hJobData.properties.requires || [];

      hJobData.properties.requires.push({
        kind: 'env',
        uri: 'https://supermarket.chef.io/cookbooks/' + name,
        revision: version,
        self_resolve: true
      });
    });

    _.each(metadata.replacing, function(version, name) {
      hJobData.properties.provides = hJobData.properties.provides || [];

      hJobData.properties.provides.push({
        kind: 'env',
        uri: 'https://supermarket.chef.io/cookbooks/' + name,
        revision: version
      });
    });

    if (!_.isEmpty(metadata.recommendations) && !_.isEmpty(metadata.suggestions))
      metadata.recommendations = _.merge(metadata.recommendations, metadata.suggestions);
    else if (!_.isEmpty(metadata.suggestions))
      metadata.recommendations = metadata.suggestions;

    _.each(metadata.recommendations, function(version, name) {
      hJobData.properties.recommends = hJobData.properties.recommends || [];

      hJobData.properties.recommends.push({
        kind: 'env',
        uri: 'https://supermarket.chef.io/cookbooks/' + name,
        revision: version
      });
    });

    _.each(metadata.conflicting, function(version, name) {
      hJobData.properties.conflicts = hJobData.properties.conflicts || [];

      hJobData.properties.conflicts.push({
        kind: 'env',
        uri: 'https://supermarket.chef.io/cookbooks/' + name,
        revision: version
      });
    });

    if (!_.isEmpty(metadata.recipes)) {
      hJobData.properties.chef_recipes = metadata.recipes;
    }

    if (!_.isEmpty(metadata.attributes)) {
      hJobData.properties.parameters = {};

      _.each(metadata.attributes, function(attr, name) {
        hJobData.properties.parameters[name] = attr;
        hJobData.properties.parameters[name].mapping = 'cookbook_attribute';
      });
    }

    //TODO: if _.isEmpty(hJobData.properties.recipes) -> read recipe files and add them to properties!

    //TODO: if _.isEmpty(hJobData.properties.attributes) -> read files in path.join(hJobData.base, _.first(hJobData.dirs).name, 'attributes') and sub-dirs

    done(null, hJobData);
  };

  return obj;
};
