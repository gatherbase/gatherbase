var _ = require('lodash');



var normalize = function(str) {
  return str.toLowerCase().replace(/[\W_]+/g, '');
}



module.exports = function(spec) {
  var obj = {};

  spec = spec || {};
  spec.config = spec.config || {};

  obj.handle = function(hJobData, log, progress, done) {
    var searchStr = hJobData.properties.name + hJobData.properties.description;

    _.each(spec.config.taxonomyKeywords, function(label, keyword) {
      if (_.includes(normalize(searchStr), keyword)) {
        hJobData.properties.labels = hJobData.properties.labels || [];

        hJobData.properties.labels.push(label);

        //TODO think: maybe limit to one label to be added
      }
    });

    var excludedLabels = [];

    _.each(hJobData.properties.labels, function(label) {
      var labelParts = label.split('/');

      while (_.size(labelParts) > 1) {
        labelParts = _.initial(labelParts);

        var parentLabel = labelParts.join('/');

        if (!_.includes(excludedLabels, parentLabel)) excludedLabels.push(parentLabel);
      }
    });

    hJobData.properties.labels = _.uniq(_.filter(hJobData.properties.labels, function(label) {
      return !_.includes(excludedLabels, label)
    }));

    done();
  };

  return obj;
};
