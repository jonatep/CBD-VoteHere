/*global todomvc */
'use strict';

/**
 * Services that persists and retrieves TODOs from localStorage
 */
votingmvc.factory('votingStorage', function ($http) {
  var STORAGE_ID = 'votings-angularjs';

  return {
    get: function () {
      var url = '/voting-list';
      return $http.get(url);
    }
  };
});
