/*global todomvc, angular */
'use strict';

/**
 * The main controller for the app. The controller:
 * - retrieves and persists the model via the todoStorage service
 * - exposes the model to the template and provides event handlers
 */
votingmvc.controller('VotingCtrl', function TodoCtrl($scope, $routeParams, votingStorage, filterFilter) {
  $scope.votings = [];

  votingStorage.get().success(function(votings) {
    $scope.votings = votings;
  }).error(function(error) {
    alert('Failed to load Votings');

  });

});
