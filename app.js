(function() {


  var DAILY_ADD_URI = "%@/daily/add.json",
      DAILY_URI     = "%@/daily.json",
      HARVEST_URI   = "%@/daily",
      TIMER_URI     = "%@/daily/timer/%@.json",
      ENTRIES_URI   = "%@/external/hours.json?namespace=https://%@.zendesk.com&external_id=%@",
      MONTH_NAMES   = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  return {
    defaultState: 'loading',

    // Local vars
    DELAY            : 60000,
    MAX_ENTRIES      : 5,
    clients          : [],
    currentTimeoutID : undefined,
    entryID          : undefined,
    projects         : [],
    
    requests: {
      'getEverything':  function() { return this._getRequest( helpers.fmt(DAILY_URI, this.settings.url) ); },
      'getEntries'    : function() { return this._getRequest( helpers.fmt(ENTRIES_URI, this.settings.url, this.currentAccount().subdomain(), this.ticket().id()) ); },
      'getAuth':        function() { return this._getRequest( helpers.fmt(DAILY_URI, this.settings.url) ); },
      'postHours':      function(data) { return this._postRequest( data, helpers.fmt(DAILY_ADD_URI, this.settings.url) ); },
      'startTimer':     function(data) { return this._postRequest( data, helpers.fmt(DAILY_ADD_URI, this.settings.url) ); },
      'stopTimer':      function(entryID) { return this._getRequest( helpers.fmt(TIMER_URI, this.settings.url, entryID) ); }
    },

    events: {
      'change .submit_form .projects'       : 'changeProject',
      'click .entry .submit'                : 'stopTimer',
      'click .submit_form .add_duration'    : 'toggleHoursTimer',
      'click .submit_form .cancel_duration' : 'toggleHoursTimer',
      'click .message .back'                : 'firstRequest',
      'click .submit_form .submit'          : 'submitForm',
      'click .login_form .submit'           : 'submitLogin',
      'click .to_harvest .view_timesheet'   : 'changeHref',
      'click .user_info .logout'            : 'logout',
      'keypress .hours input[name=hours]'   : 'maskUserInput',

      /* Data API events */
      'currentAccount.subdomain.changed'    : 'handleSubdomainChanged',

      'app.activated'                       : 'appActivated',

      /** Ajax Callbocks **/
      'getEverything.done'                  : 'handleGetEverythingResult',
      'getEntries.done'                     : 'handleGetEntriesResult',
      'getAuth.done'                        : 'handleGetAuthResult',
      'postHours.done'                      : 'handlePostHoursResult',
      'startTimer.done'                     : 'handleStartTimerResult',
      'stopTimer.done'                      : 'handleStopTimerResult',

      'getEverything.fail'                  : 'handleFailedRequest',
      'getAuth.fail'                        : 'handleAuthFailedRequest',
      'getEntries.fail'                     : 'handleFailedRequest',
      'postHours.fail'                      : 'handleFailedRequest',
      'startTimer.fail'                     : 'handleFailedRequest',
      'stopTimer.fail'                      : 'handleFailedRequest'
    },

    appActivated: function(data) {
      var firstLoad = data && data.firstLoad;
      if ( !firstLoad ) { return; }

      var login = true;
      _.each(['username', 'password'], function(key) {
        if (!_.isUndefined(this.settings[key])) {
          this.store(key, this.settings[key]);
        } else {
          login = false;
        }
      }, this);

      if (login) {
        this.firstRequest();
      } else {
        this.switchTo('login');
      }
    },

    changeHref: function() { this.$('.to_harvest .view_timesheet').attr('href', helpers.fmt(HARVEST_URI, this.settings.url)); },

    changeProject: function() {
      var form = this.$('.submit_form form'),
          hours = form.find('input[name=hours]').val(),
          notes = form.find('textarea[name=notes]').val(),
          projectID = form.find('select[name=project_id]').val();

      if ( projectID.length === 0 ) { return; }

      this.switchTo('submitForm', { clients: this.clients, hours: hours, notes: notes, tasks: this.projects[projectID] });

      this.$('.submit_form form select[name=project_id]').val(projectID);
    },

    firstRequest: function() {
      this._resetAppState();
      this.ajax('getEverything');
      this.handleSubdomainChanged();
    },

    handleSubdomainChanged: function() {
      if (this.currentAccount() &&
          _.isString(this.currentAccount().subdomain())) {
        this.ajax('getEntries');
      }
    },

    handleGetEntriesResult: function(data, textStatus, response) {
      // Render entries
      var entryData = _.map(_.toArray(data).reverse().slice(0, this.MAX_ENTRIES), function(entry) {
        var dayEntry = entry.day_entry,
            entryDate = new Date(Date.parse(dayEntry.spent_at));
        return {
          name: helpers.fmt('%@ %@. (%@)', dayEntry.user_first_name, dayEntry.user_last_name.charAt(0).toUpperCase(), helpers.fmt('%@ %@', MONTH_NAMES[entryDate.getMonth()], entryDate.getDate())),
          hours: dayEntry.hours
        };
      });
      if (_.isEmpty(entryData)) {
        return;
      }
      var entries = this.renderTemplate('entries', {
        entries: entryData
      });
      this.$('.entries').empty().append(entries);
    },

    handleGetAuthResult: function(data, textStatus, response) {
      this.ajax('getEntries');
      this.handleGetEverythingResult(data, textStatus. response);
    },

    handleAuthFailedRequest: function(jqXHR, textStatus, errorThrown) {
      this._resetAuthState();
      this.showLoginInfo(false);
      var message = textStatus === 'parsererror' ?
                                    this.I18n.t('invalidResponse') :
                                    this.I18n.t('problem', { error: jqXHR.responseText });
      // Show error message on login screen.
      this.switchTo('login', {
        message: this.I18n.t('loginError')
      });
    },

    handleGetEverythingResult: function(data, textStatus, response) {
      var divTimer = this.$('.entry'),
          projects = data.projects || [],
          notes;

      if ( !this._authenticated() ) {
        this.switchTo('login');
        return;
      }

      // Validation
      if ( this._throwException(_.has(data, 'projects'), response) ) { return; }
      if ( projects.length === 0 ) { this.showError(this.I18n.t('form.no_projects')); return; }

      // If timer for this ticket is running, render it, otherwise, show submit form
      if ( this.timerRunning(data) ) {
        this.renderTimer(data.day_entries.get('lastObject')); return;
      } else if ( divTimer.is(':visible') ) { // Special case: API returned that timer stopped, with no user input
        this.showError(this.I18n.t('timer_stopped')); return;
      }

      this._populateClientsAndProjects(projects);

      this.showLoginInfo(true);

      this.switchTo('submitForm', { clients: this.clients, notes: this._getNotes() });
    },

    handlePostHoursResult: function(data, textStatus, response) {
      if ( this._throwException(_.has(data, 'hours'), response) ) { return; }

      this.showSuccess(this.I18n.t('form.success'));
    },

    handleStartTimerResult: function(data, textStatus, response) {
      if ( this._throwException(_.has(data, 'hours'), response) ) { return ; }

      this.renderTimer(data);
    },

    handleStopTimerResult: function(data, textStatus, response) {
      if ( this._throwException(_.has(data, 'hours'), response) ) { return; }

      this.showSuccess(this.I18n.t('form.success'));
    },

    maskUserInput: function(event) {
      var charCode = event.which, value = event.target.value;

      if (charCode > 58 || (charCode < 48 && charCode !== 46 && charCode !== 8) ) { // Not number, '.', ':' or Backspace
        return false;
      } else if ((charCode === 46 || charCode === 58) && (value.search(/\./) > -1 || value.search(/:/) > -1)) { // Only one '.' OR one ':'
        return false;
      }
    },

    renderTimer: function(entry) {
      var fields = [], hours;

      this.entryID = entry.id;
      hours = this._floatToHours(entry.hours);

      ['client', 'project', 'task', 'notes'].forEach(function(item) {
        fields.pushObject({ label: this.I18n.t(helpers.fmt("form.%@", item)), value: entry[item] });
      }, this);

      this.switchTo('entry', { fields: fields, hours: hours });

      this.scheduleCheck(); // Keeps updating the timer
    },

    scheduleCheck: function() {
      var self = this;
      this.currentTimeoutID = setTimeout(function() {
        self.firstRequest();
      }, this.DELAY);
    },

    stopTimer: function() {
      clearTimeout(this.currentTimeoutID); // Stop timer.
      this.disableSubmit(this.$('.entry'));
      this.ajax('stopTimer', this.entryID);
    },

    // Submit hours or start timer.
    // Timer is exactly the same request as 'submit hours', but with hours field empty (API will start the timer instead of just saving hours).
    submitForm: function() {
      var form = this.$('.submit_form form'), data, empties, test, divHours = form.find('.hours'), hours = form.find('input[name=hours]'),
          notes = form.find('textarea[name=notes]'), project = form.find('select[name=project_id]'), task = form.find('select[name=task_id]');

      test = divHours.is(':visible') ? [project, task, hours] : [project, task];
      empties = test.filter(function(item, index, self) {
        if ( !item.val() ) { return true; }
      });

      if ( empties.get('length') ) {
        alert( this.I18n.t('form.empty', { field: empties.get('firstObject').attr('name').replace('_id', '').capitalize() }) );
        return false;
      }

      this.disableSubmit(form);
      
      data = {
        project_id         : project.val(),
        task_id            : task.val(),
        notes              : notes.val(),
        hours              : hours.val(),
        external_ref : {
          namespace : helpers.fmt("https://%@.zendesk.com", this.currentAccount().subdomain()),
          id        : this.ticket().id()
        }
      };

      if ( divHours.is(':visible') ) {
        this.ajax('postHours', data);
      } else {
        this.ajax('startTimer', data);
      }
    },

    submitLogin: function(evt) {
      var $form = this.$('.login_form form'),
          $email = $form.find('input[name=email]'),
          $password = $form.find('input[name=password]');

      if (this.validateForm($form)) {
        this.disableSubmit($form);
        this.store('email', $email.val());
        this.store('password', $password.val());
        this._resetAppState();
        this.ajax('getAuth');
      }
      return false;
    },

    logout: function(evt) {
      this._resetAppState();
      this._resetAuthState();
      this.showLoginInfo(false);
      this.switchTo('login');
      return false;
    },

    timerRunning: function(data) {
      var dayEntries = data.day_entries || [], lastDayEntry = dayEntries.get('lastObject'), match;

      if (lastDayEntry && lastDayEntry.timer_started_at) { // timer_started_at present if timer is running.
        match = lastDayEntry.notes.match(/Zendesk #([\d]*)/);
        if (match && match[1] == this.ticket().id()) { return true; }
      }
      return false;
    },

    toggleHoursTimer: function() {
      var form = this.$('.submit_form'), divHours = form.find('.hours'), divTimer = form.find('.timer'), hours = form.find('input[name=hours]');

      divTimer.toggle();
      divHours.toggle();
      hours.val('');
    },

    _floatToHours: function(num) {
      var hour = Math.floor(num), minutes = Math.floor((num - hour) * 60);
      if ( hour < 10 ) { hour = helpers.fmt("0%@", hour); }
      if ( minutes < 10 ) { minutes = helpers.fmt("0%@", minutes); }
      return (helpers.fmt("%@:%@", hour, minutes));
    },

    _getNotes: function() {
      if (_.isString(this.settings.defaultNote) && this.settings.defaultNote.length > 0) {
        return this.settings.defaultNote;
      }
      // TODO: after https://zendesk.atlassian.net/browse/APPS-203 is done
      //       and deployed to production, remove ", this._renderContext()".
      return this.I18n.t('form.notes_message', this._renderContext());
    },

    _getRequest: function(resource) {
      return {
        dataType: 'json',
        url:      resource,
        headers: {
          'Authorization': 'Basic ' + Base64.encode(helpers.fmt('%@:%@', this.store('email'), this.store('password')))
        }
      };
    },

    _populateClientsAndProjects: function(array) {
      var lastClient = '';

      array.forEach(function(project) {
        this.projects[project.id] = project.tasks;

        if ( project.client === lastClient ) {
          this.clients.get('lastObject').projects.pushObject(project);
        } else {
          this.clients.pushObject( { name: project.client, projects: [ project ] } );
        }
        lastClient = project.client;
      }, this);
    },

    _postRequest: function(data, resource) {
      return {
        dataType:     'json',
        data:         data,
        processData:  false,
        type:         'POST',
        url:          resource,
        headers: {
          'Authorization': 'Basic ' + Base64.encode(helpers.fmt('%@:%@', this.settings.username, this.settings.password))
        }
      };
    },

    _resetAppState: function() {
      this.clients =  [];
      this.entryID =  undefined;
      this.projects = [];

      this.$('.entries').empty();

      clearTimeout(this.currentTimeoutID);
    },

    _resetAuthState: function() {
      var self = this;
      _.each(['email', 'password'], function(key) {
        self.store(key, false);
      });
    },

    _throwException: function(field, response) {
      if ( !field ) {
        this.showError(this.I18n.t('exception', { error: response.responseText })); // API returns text and status code 200 when request fails =/
        return true;
      }
      return false;
    },

    _authenticated: function() {
      return _.isString(this.store('email')) &&
        _.isString(this.store('password'));
    },

    /** Helpers **/
    disableSubmit: function(form) {
      var $submit = form.find('input[type=submit]');
      $submit
        .data('originalValue', $submit.val())
        .prop('disabled', true)
        .val(this.I18n.t('global.submitting'));
    },

    enableSubmit: function(form) {
      var submit = this.$(form.find('input[type=submit]'));
      submit
        .prop('disabled', false)
        .val(submit.data('originalValue'));
    },

    // API returns text and status code 200 when request fails =/
    handleFailedRequest: function(jqXHR, textStatus, errorThrown) {
      this._resetAuthState();
      this.showLoginInfo(false);
      var message = textStatus === 'parsererror' ?
                                    this.I18n.t('invalidResponse') :
                                    this.I18n.t('problem', { error: jqXHR.responseText });
      this.showError(message);
    },

    showError: function(msg) {
      this.switchTo('error', { message: msg });
    },

    showSuccess: function(msg) {
      this.switchTo('success', { message: msg });
    },

    showLoginInfo: function(show) {
      var $userInfo = this.$('.user_info'),
          $toHarvest = this.$('.to_harvest');
      if (_.isBoolean(show) && show) {
        $userInfo.empty().append(this.renderTemplate('user_info')).show();
        $toHarvest.show();
      } else {
        $userInfo.hide();
        $toHarvest.hide();
      }
    },

    invalidFields: function($form) {
      var self = this;
      return $form.find('input').filter(function(index, field) {
        var $f = self.$(field),
            isBlank = ($f.val() == null || $f.val() === '');
        return $f.attr('required') && isBlank;
      });
    },

    notifyInvalidFields: function($invalidFields) {
      var self = this;
      $invalidFields.each(function(index, field) {
        var $f = self.$(field),
            message = self.I18n.t('form.empty', { field: $f.data('fieldTitle') });
        services.notify(message, 'error');
      });
    },

    validateForm: function($form) {
      var $invalidFields = this.invalidFields($form),
          anyInvalidFields = $invalidFields.length > 0;
      this.notifyInvalidFields($invalidFields);
      return !anyInvalidFields;
    }

  };

}());
