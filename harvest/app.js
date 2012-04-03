(function() {

  return ZendeskApps.defineApp(ZendeskApps.Site.TICKET_PROPERTIES, {
    appID: '/apps/01-harvest/versions/1.0.0',
    name: 'Harvest',

    defaultSheet: 'loading',

    dependencies: {
      currentTicketID:      'workspace.ticket.id',
      currentTicketSubject: 'workspace.ticket.subject',
      requesterName:        'workspace.ticket.requester.name'
    },

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
      PROXY_URI:      "/proxy/direct?url=%@&timeout=10",
      TIMER_URI:      "%@/daily/timer/%@.json"
    },

    translations: {
      exception: "An error occured: %@",

      form: {
        add_duration:     "Add Duration",
        cancel_duration:  "Cancel Duration",
        client:           "Client",
        empty:            "{{field}} is empty!",
        no_projects:      "No projects found for your Harvest account!",
        hours:            "Hours",
        notes:            "Notes",
        notes_message:    'Zendesk #%@ "%@" %@',
        project:          "Project",
        start_timer:      "Start Timer",
        stop_timer:       "Stop Timer",
        success:          "Hours sucessfuly logged!",
        task:             "Task"
      },

      global: {
        back:       "Back",
        submit:     "Submit",
        submitting: "Submitting..."
      },

      problem: "There's been a problem: {{error}}",

      timer_stopped: "Someone else stopped the timer!",

      view_timesheet: "View your Harvest timesheet"
    },

    xmlTemplates: {
      ADD:  'body=' +
            '<request>' +
            '  <notes><![CDATA[%@]]></notes>' +
            '  <hours>%@</hours>' +
            '  <project_id type="integer">%@</project_id>' +
            '  <task_id type="integer">%@</task_id>' +
            '  <spent_at type="date">%@</spent_at>' +
            '</request>'
    },

    templates: {
      main:     '<div class="harvest_app">' +
                '  <div><h3>Harvest <span class="loader" style="display: none;"></span></h3></div><hr/>' +
                '  <section data-sheet-name="loading" class="loading"></section>' +
                '  <section data-sheet-name="entry" class="entry"></section>' +
                '  <section data-sheet-name="message" class="message"></section>' +
                '  <section data-sheet-name="submitForm" class="submit_form"></section>' +
                '  <section class="to_harvest"><hr/><p><a href="#" onclick="" class="view_timesheet" target="_blank">{{I18n.view_timesheet}}...</a></p></section>' +
                '</div>',
      entryData:  '<ul>{{#fields}}<li class="field"><p><span class="field_label">{{label}}</span></p><p>{{value}}</p></li>{{/fields}}</ul>' +
                  '<p class="input">' +
                  '  <span class="time">{{hours}}</time></span>' +
                  '  &nbsp;&nbsp; <input type="submit" value="{{I18n.form.stop_timer}}" class="submit" onclick="return false"/>' +
                  '</p>',
      formData: '<form>' +
                '<p class="info">{{I18n.form.info}}</p>' +
                '<div class="field">' +
                '  <p class="title">{{I18n.form.project}}</p>' +
                '  <p><select class="projects" name="project_id"><option></option>' +
                '    {{#clients}}<optgroup label="{{name}}">' +
                '      {{#projects}}<option value="{{id}}">{{name}}</option>{{/projects}}' +
                '    </optgroup>{{/clients}}' +
                '  </select></p>' +
                '</div>' +
                '<div class="field">' +
                '  <p class="title">{{I18n.form.task}}<p>' +
                '  <p><select name="task_id">' +
                '    {{#tasks}}<option value="{{id}}">{{name}}</option>{{/tasks}}' +
                '  </select></p>' +
                '</div>' +
                '<div class="field">' +
                '  <p class="title">{{I18n.form.notes}}<p>' +
                '  <p><textarea class="notes" name="notes">{{notes}}</textarea></p>' +
                '</div>' +
                '<div class="hours" style="display: none;">' +
                '  <div class="field">' +
                '    <p class="title">{{I18n.form.hours}}<p>' +
                '    <p>' +
                '      <input class="input_hours" type="text" name="hours" value="{{hours}}" />' +
                '      &nbsp;&nbsp;&nbsp;&nbsp; <a class="cancel_duration" href="#" onclick="return false;">{{I18n.form.cancel_duration}}</a>' +
                '    </p>' +
                '  </div>' +
                '  <p class="input"><input type="submit" value="{{I18n.global.submit}}" class="submit" onclick="return false"/></p>' +
                '</div>' +
                '<div class="timer">' +
                '  <p class="input">' +
                '    <input type="submit" value="{{I18n.form.start_timer}}" class="submit" onclick="return false"/>' +
                '    &nbsp;&nbsp;&nbsp;&nbsp; <a class="add_duration" href="#" onclick="return false;">{{I18n.form.add_duration}}</a>' +
                '  </p>' +
                '</div>' +
                '</form>',
      error:    '<div class="error">{{message}}</div>' +
                '<div class="back"><a href="#" onclick="return false;"><< {{I18n.global.back}}</a></div>',
      success:  '<div class="success">{{message}}</div>' +
                '<div class="back"><a href="#" onclick="return false;"><< {{I18n.global.back}}</a></div>'
    },

    launch: function(host, settings) {
      this.firstRequest();
    },

    requests: {
      'getEverything':  function() { return this._getRequest( this.resources.DAILY_URI.fmt(this.settings.url) ); },
      'postHours':      function(data) { return this._postRequest( data, this.resources.DAILY_ADD_URI.fmt(this.settings.url) ); },
      'startTimer':     function(data) { return this._postRequest( data, this.resources.DAILY_ADD_URI.fmt(this.settings.url) ); },
      'stopTimer':      function(entryID) { return this._getRequest( this.resources.TIMER_URI.fmt(this.settings.url, entryID) ); }
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

      /** Ajax Callbocks **/
      'getEverything.success':  'handleGetEverythingResult',
      'postHours.success':      'handlePostHoursResult',
      'startTimer.success':     'handleStartTimerResult',
      'stopTimer.success':      'handleStopTimerResult',

      'getEverything.fail':     'handleFailedRequest',
      'postHours.fail':         'handleFailedRequest',
      'startTimer.fail':        'handleFailedRequest',
      'stopTimer.fail':         'handleFailedRequest'
    },

    changeHref: function() { this.$('.to_harvest .view_timesheet').attr('href', this.resources.HARVEST_URI.fmt(this.settings.url)); },

    changeProject: function() {
      var form = this.$('.submit_form form'), hours = form.find('input[name=hours]').val(),
          notes = form.find('textarea[name=notes]').val(), projectID = form.find('select[name=project_id]').val();

      if ( projectID.length === 0 ) { return; }

      this.sheet('submitForm')
          .render('formData', { clients: this.clients, hours: hours, notes: notes, tasks: this.projects[projectID] })
          .show();

      this.$('.submit_form form select[name=project_id]').val(projectID);
    },

    firstRequest: function() {
      this._resetAppState();
      this.request('getEverything').perform();
    },

    handleGetEverythingResult: function(e, data, textStatus, response) {
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
      notes = this.I18n.t('form.notes_message').fmt(this.deps.currentTicketID, this.deps.currentTicketSubject, this.deps.requesterName);
      this.sheet('submitForm')
          .render('formData', { clients: this.clients, notes: notes })
          .show();
    },

    handlePostHoursResult: function(e, data, textStatus, response) {
      var dayEntry = this.$(data).find('day_entry');

      if ( this._throwException(dayEntry.length, response) ) { return; }

      this.showSuccess(this.I18n.t('form.success'));
    },

    handleStartTimerResult: function(e, data, textStatus, response) {
      var fields = [], dayEntry = this.$(data).find('day_entry');

      if ( this._throwException(dayEntry.length, response) ) { return ; }

      this.renderTimer(dayEntry);
    },

    handleStopTimerResult: function(e, data, textStatus, response) {
      if ( this._throwException(data.hours, response) ) { return; }

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
        fields.pushObject({ label: this.I18n.t("form.%@".fmt(item)), value: this._getField(entry, item) });
      }, this);

      this.sheet('entry')
          .render('entryData', { fields: fields, hours: hours })
          .show();

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
      this.request('stopTimer').perform(this.entryID);
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
        this.request('postHours').perform(data);
      } else {
        this.request('startTimer').perform(data);
      }
    },

    timerRunning: function(data) {
      var dayEntries = data.day_entries || [], lastDayEntry = dayEntries.get('lastObject'), match;

      if (lastDayEntry && lastDayEntry.timer_started_at) { // timer_started_at present if timer is running.
        match = lastDayEntry.notes.match(/Zendesk #([\d]*)/);
        if (match && match[1] == this.deps.currentTicketID) { return true; }
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
      if ( hour < 10 ) { hour = "0%@".fmt(hour); }
      if ( minutes < 10 ) { minutes = "0%@".fmt(minutes); }
      return ("%@:%@".fmt(hour, minutes));
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
        url:      this._proxyURL( resource ),
        headers:      {
          'Authorization': 'Basic ' + Base64.encode('%@:%@'.fmt(this.settings.username, this.settings.password))
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
        url:          this._proxyURL( resource ),
        headers:      {
          'Authorization': 'Basic ' + Base64.encode('%@:%@'.fmt(this.settings.username, this.settings.password))
        }
      };
    },

    _proxyURL: function(resource) {
      return encodeURI(this.resources.PROXY_URI.fmt(resource));
    },

    _resetAppState: function() {
      this.clients =  [];
      this.entryID =  undefined;
      this.projects = [];

      clearTimeout(this.currentTimeoutID);
    },

    _throwException: function(field, response) {
      if ( !field ) {
        this.showError(this.I18n.t('exception').fmt(response.responseText)); // API returns text and status code 200 when request fails =/
        return true;
      }
      return false;
    },

    _xmlTemplateAdd: function(options) {
      return encodeURI( this.xmlTemplates.ADD.fmt(options.notes, options.hours, options.project_id, options.task_id, options.spent_at) );
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
    handleFailedRequest: function(event, jqXHR, textStatus, errorThrown) { this.showError( this.I18n.t('problem', { error: jqXHR.responseText }) ); },

    showError: function(msg) {
      this.sheet('message')
        .render('error', { message: msg })
        .show();
    },

    showSuccess: function(msg) {
      this.sheet('message')
        .render('success', { message: msg })
        .show();
    }

  });

}());
