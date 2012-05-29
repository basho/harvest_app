(function() {

  return ZendeskApps.defineApp(ZendeskApps.Site.TICKET_SIDEBAR, {
    appID: '/apps/01-crm-integration/versions/1.0.0',

    // Local vars
    currentDelay: 5000,
    currentTimeoutID: undefined,
    timesRequested: 0,
    INITIAL_DELAY: 5000,
    MAX_SYNC_RETRIES: 5,

    defaultState: 'loading',

    dependencies: {
      requesterID:  'requester.id'
    },

    requests: {
      lookupByID:   function(userID) { return { url: encodeURI(helpers.fmt("/api/v2beta/crm/%@.json", userID)) }; },
      syncUserInfo: function(userID) { return { url: encodeURI(helpers.fmt("/api/v2beta/crm/%@/sync_user_info.json", userID)) }; }
    },

    events: {
      'click .records .records_toggle': 'toggleShowMore',

      /** App callbacks **/
      'requesterID.changed': 'firstLookup',

      /** Ajax callbacks **/
      'lookupByID.done':   'handleLookupResult',
      'syncUserInfo.done': 'handleSyncUserInfoResult',

      'lookupByID.fail':                'handleFailedRequest',
      'handleSyncUserInfoResult.fail':  'handleFailedRequest'
    },

    firstLookup: function() {
      this._resetAppState();

      if (this.dependency('requesterID'))
        this.ajax('lookupByID', this.dependency('requesterID'));
    },

    handleLookupResult: function(e, data, textStatus, response) {
      var records = data.records || [];

      if (response.status === 202) { // syncing user with CRM
        this._scheduleCheck();

        if (records.length === 0) {
          this.showMessage(this.I18n.t('sync.pending'));
          return;
        }
      }

      this._renderRecords(records);
    },

    handleSyncUserInfoResult: function(e, data, textStatus, response) {
      var records = data.records || [];

      //remove spinning
      this.hideLoader();

      // Returned 303 and location header, which redirects to show and returns request result
      // If response is slow, GET show can return 202 (just show the data and avoid entering a loop)
      if ( (response.status === 200 && data.state === undefined) || response.status === 202 ) {
        this._renderRecords(records);
        return;
      }

      switch(data.state) {
        case "pending":
          this._scheduleCheck();
          break;
        case "done": // Should not execute this codepath, just to be safe
          this._renderRecords(records);
          break;
        case "failed":
          this.appendError(this.I18n.t('sync.error'));
          break;
        default:
          this.appendError(this.I18n.t('sync.error'));
      }
    },

    _renderRecords: function(records) {
      this.switchTo('records', { mainRecord: records[0], showMore: records.slice(1).length, subRecords: records.slice(1) });
    },

    _resetAppState: function() {
      this.switchTo('loading');
      this.currentDelay = this.INITIAL_DELAY;
      this.timesRequested = 0;
      this.hideLoader();
      this.$('.append_error').html('');
      clearTimeout(this.currentTimeoutID);
    },

    _scheduleCheck: function() {
      var self = this;
      this.timesRequested++;

      if (this.timesRequested > this.MAX_SYNC_RETRIES) {
        this.appendError(this.I18n.t('sync.error'));
        return;
      }

      // show spinning
      this.showLoader();

      this.currentTimeoutID = setTimeout(function() {
        self.ajax('syncUserInfo', self.dependency('requesterID'));
      }, this.currentDelay);

      this.currentDelay *= 2;
    },

    toggleShowMore: function() {
      var self = this;

      this.$(".records .sub_records").slideToggle(function() {
        self.$(".records_toggle").toggle();
      });
    },

    /** Helpers **/
    appendError: function(msg) {
      this.$('.append_error').html(msg);
    },

    handleFailedRequest: function(event, jqXHR, textStatus, errorThrown) { this.showError( this.I18n.t('problem', { error: errorThrown.toString() }) ); },

    hideLoader: function() {
      this.$('.loader').hide();
      this.$('.logo').show();
    },

    showLoader: function() {
      this.$('.logo').hide();
      this.$('.loader').show();
    },

    showError: function(msg) {
      this.switchTo('error', { message: msg });
    },

    showMessage: function(msg) {
      this.switchTo('info', { message: msg });
    }
  });

}());
