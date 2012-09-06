(function() {

  return {
    defaultState: 'loading',

    // Local vars
    DELAY:            60000,
    clients:          [],
    currentTimeoutID: undefined,
    entryID:          undefined,
    projects:         [],

    resources: {
      DAILY_ADD_URI:  "%@/daily/add.xml",
      DAILY_URI:      "%@/daily.json",
      HARVEST_URI:    "%@/daily",
      TIMER_URI:      "%@/daily/timer/%@.json"
    },

    requests: {
      'getEverything':  function() { return this._getRequest( helpers.fmt(this.resources.DAILY_URI, this.settings.url) ); },
      'postHours':      function(data) { return this._postRequest( data, helpers.fmt(this.resources.DAILY_ADD_URI, this.settings.url) ); },
      'startTimer':     function(data) { return this._postRequest( data, helpers.fmt(this.resources.DAILY_ADD_URI, this.settings.url) ); },
      'stopTimer':      function(entryID) { return this._getRequest( helpers.fmt(this.resources.TIMER_URI, this.settings.url, entryID) ); }
    },

    events: {
      'change .submit_form .projects':        'changeProject',
      'click .entry .submit':                 'stopTimer',
      'click .submit_form .add_duration':     'toggleHoursTimer',
      'click .submit_form .cancel_duration':  'toggleHoursTimer',
      'click .message .back':                 'firstRequest',
      'click .submit_form .submit':           'submitForm',
      'click .to_harvest .view_timesheet':    'changeHref',
      'keypress .hours input[name=hours]':    'maskUserInput',

      'app.activated': 'appActivated',

      /** Ajax Callbocks **/
      'getEverything.done':  'handleGetEverythingResult',
      'postHours.done':      'handlePostHoursResult',
      'startTimer.done':     'handleStartTimerResult',
      'stopTimer.done':      'handleStopTimerResult',

      'getEverything.fail':     'handleFailedRequest',
      'postHours.fail':         'handleFailedRequest',
      'startTimer.fail':        'handleFailedRequest',
      'stopTimer.fail':         'handleFailedRequest'
    },

    appActivated: function(data) {
      var firstLoad = data && data.firstLoad;
      if ( !firstLoad ) { return; }

      this.firstRequest();
    },

    changeHref: function() { this.$('.to_harvest .view_timesheet').attr('href', helpers.fmt(this.resources.HARVEST_URI, this.settings.url)); },

    changeProject: function() {
      var form = this.$('.submit_form form'), hours = form.find('input[name=hours]').val(),
          notes = form.find('textarea[name=notes]').val(), projectID = form.find('select[name=project_id]').val();

      if ( projectID.length === 0 ) { return; }

      this.switchTo('submitForm', { clients: this.clients, hours: hours, notes: notes, tasks: this.projects[projectID] });

      this.$('.submit_form form select[name=project_id]').val(projectID);
    },

    firstRequest: function() {
      this._resetAppState();
      this.ajax('getEverything');
    },

    handleGetEverythingResult: function(data, textStatus, response) {
      var self = this, divTimer = this.$('.entry'), notes, projects = data.projects || [];

      // Validation
      if ( this._throwException(data.projects, response) ) { return; }
      if ( projects.length === 0 ) { this.showError(this.I18n.t('form.no_projects')); return; }

      // If timer for this ticket is running, render it, otherwise, show submit form
      if ( this.timerRunning(data) ) {
        this.renderTimer(data.day_entries.get('lastObject')); return;
      } else if ( divTimer.is(':visible') ) { // Special case: API returned that timer stopped, with no user input
        this.showError(this.I18n.t('timer_stopped')); return;
      }

      this._populateClientsAndProjects(projects);
      notes = helpers.fmt(this.I18n.t('form.notes_message'), this.ticket().id(), this.ticket().subject(), this.ticket().requester().name());
      this.switchTo('submitForm', { clients: this.clients, notes: notes });
    },

    handlePostHoursResult: function(data, textStatus, response) {
      var dayEntry = this.$(data).find('day_entry');

      if ( this._throwException(dayEntry.length, response) ) { return; }

      this.showSuccess(this.I18n.t('form.success'));
    },

    handleStartTimerResult: function(data, textStatus, response) {
      var fields = [], dayEntry = this.$(data).find('day_entry');

      if ( this._throwException(dayEntry.length, response) ) { return ; }

      this.renderTimer(dayEntry);
    },

    handleStopTimerResult: function(data, textStatus, response) {
      if ( this._throwException(data.hours != null, response) ) { return; }

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

    // From handleGetEverythingResult: json. From handleStartTimerResult: XML. Meaning: give any kind of data, it'll render.
    renderTimer: function(entry) {
      var fields = [], hours;

      this.entryID = this._getField(entry, 'id');
      hours = this._floatToHours(this._getField(entry, 'hours'));

      ['client', 'project', 'task', 'notes'].forEach(function(item) {
        fields.pushObject({ label: this.I18n.t(helpers.fmt("form.%@", item)), value: this._getField(entry, item) });
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
      data = this._xmlTemplateAdd({ hours: hours.val(), notes: notes.val(), project_id: project.val(), spent_at: Date('dd/mm/yyyy'), task_id: task.val() });
      if ( divHours.is(':visible') ) {
        this.ajax('postHours', data);
      } else {
        this.ajax('startTimer', data);
      }
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

    _getField: function(obj, field) {
      if ( typeof(obj.children) === 'function' ) { // XML
        return obj.children(field).text();
      } else if ( typeof(obj) === 'object' ) { // json
        return obj[field];
      } else {
        return undefined;
      }
    },

    _getRequest: function(resource) {
      return {
        dataType: 'json',
        url:      resource,
        headers: {
          'Authorization': 'Basic ' + Base64.encode(helpers.fmt('%@:%@', this.settings.username, this.settings.password))
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
        dataType:     'xml',
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

      clearTimeout(this.currentTimeoutID);
    },

    _throwException: function(field, response) {
      if ( !field ) {
        this.showError(this.I18n.t('exception', { error: response.responseText })); // API returns text and status code 200 when request fails =/
        return true;
      }
      return false;
    },

    _xmlTemplateAdd: function(options) {
      return this.renderAndEscapeXML('add.xml', options);
    },

    /** Helpers **/
    disableSubmit: function(form) {
      var submit = form.find('input[type=submit]');
      submit
        .data('originalValue', submit.val())
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

    renderAndEscapeXML: function(templateName, data) {
      Object.keys(data).forEach(function(key) {
        data[key] = helpers.safeString( data[key] );
      });
      return encodeURI( this.renderTemplate(templateName, data) );
    }

  };

}());
