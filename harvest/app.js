(function() {

  ZendeskApps.HarvestApp = ZendeskApps.App.extend({
    location: ZendeskApps.Site.TICKET_PROPERTIES,
    appID: '/apps/01-harvest/versions/1.0.0',
    name: 'Harvest',

    defaultSheet: 'loading',

    dependencies: {
      currentTicketID:      'Zendesk.currentTicket.id',
      currentTicketSubject: 'Zendesk.currentTicket.subject',
      requesterName:        'Zendesk.currentTicket.requester.name'
    },

    // Local vars
    clients:  [],
    projects: [],

    resources: {
      DAILY_ADD_URI:  "%@/daily/add.xml",
      DAILY_URI:      "%@/daily.json?",
      PROXY_URI:      "/proxy/direct?url=%@&timeout=10"
    },

    translations: {
      exception: "An error occured: %@",

      form: {
        empty:        "{{field}} is empty!",
        no_projects:  "No projects found for your Harvest account!",
        hours:        "Hours",
        notes: {
          message:    'Zendesk #%@ "%@" %@',
          title:      'Notes'
        },
        project:      "Select Project",
        success:      "Hours sucessfuly logged!",
        task:         "Select Task"
      },

      global: {
        back:       "Back",
        submit:     "Submit",
        submitting: "Submitting..."
      },

      problem: "There's been a problem: {{error}}"
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
                '  <div><h3>Harvest <span class="loader" style="display: none;">&nbsp;&nbsp;<img src="/console/assets/ajax-loader-1.gif"/></span></h3></div><hr/>' +
                '  <section data-sheet-name="loading" class="loading"></section>' +
                '  <section data-sheet-name="message" class="message"></section>' +
                '  <section data-sheet-name="submitForm" class="submit_form"></section>' +
                '</div>',
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
                '  <p class="title">{{I18n.form.notes.title}}<p>' +
                '  <p><textarea class="notes" name="notes">{{notes}}</textarea></p>' +
                '</div>' +
                '<div class="field">' +
                '  <p class="title">{{I18n.form.hours}}<p>' +
                '  <p><input class="input_hours" type="text" name="hours" value="{{hours}}" /></p>' +
                '</div>' +
                '<p class="input"><input type="submit" value="{{I18n.global.submit}}" class="submit" onclick="return false"/></p>' +
                '</form>',
      error:    '<div class="error">{{message}}</div>' +
                '<div class="back"><a href="#" onclick="return false;"><< {{I18n.global.back}}</a></div>',
      success:  '<div class="success">{{message}}</div>' +
                '<div class="back"><a href="#" onclick="return false;"><< {{I18n.global.back}}</a></div>'
    },

    launch: function(host, config) {
      Em.run.next(this, function() {
        this.request('getEverything').perform();
      });
    },

    requests: {
      'getEverything':  function() { return this._getRequest(); },
      'postHours':      function(data) { return this._postRequest(data); }
    },

    events: {
      'change .submit_form .projects':      'changeProject',
      'click .message .back':               'backToForm',
      'click .submit_form .submit':         'submitForm',
      'keypress .hours input[name=hours]':  'maskUserInput',

      /** Ajax Callbocks **/
      'getEverything.success':  'handleGetEverythingResult',
      'postHours.success':      'handlePostHoursResult',

      'getEverything.fail':     'handleFailedRequest',
      'postHours.fail':         'handleFailedRequest'
    },

    backToForm: function() {
      this.enableSubmit(this.$('.submit_form form'));
      this.sheet('submitForm').show();
    },

    changeProject: function() {
      var form =      this.$('.submit_form form'),
          hours =     form.find('input[name=hours]').val(),
          notes =     form.find('textarea[name=notes]').val(),
          projectID = form.find('select[name=project_id]').val();

      if (projectID.length === 0) { return; }

      this.sheet('submitForm')
          .render('formData', { clients: this.clients, hours: hours, notes: notes, tasks: this.projects[projectID] })
          .show();

      this.$('.submit_form form select[name=project_id]').val(projectID);
    },

    handleGetEverythingResult: function(e, data) {
      var self = this, array = data.projects || [], lastClient = '', notes;

      if (data.length === 0)
        this.showError(this.I18n.t('form.no_projects'));

      this.clients =  [];
      this.projects = [];

      array.forEach(function(project) {
        this.projects[project.id] = project.tasks;

        if (project.client === lastClient) {
          this.clients.get('lastObject').projects.pushObject(project);
        } else {
          this.clients.pushObject( { name: project.client, projects: [ project ] } );
        }
        lastClient = project.client;
      }, this);

      notes = this.I18n.t('form.notes.message').fmt(this.deps.currentTicketID, this.deps.currentTicketSubject, this.deps.requesterName);
      this.sheet('submitForm')
          .render('formData', { clients: this.clients, notes: notes })
          .show();
    },

    handlePostHoursResult: function(e, data, textStatus, response) {
      var dayEntry = this.$(data).find('day_entry'), form = this.$('.submit_form form');

      if (!dayEntry.length) {
        this.showError(this.I18n.t('exception').fmt(response.responseText)); // API returns text and status code 200 when request fails =/
        return;
      }

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

    submitForm: function() {
      var form = this.$('.submit_form form'), data, empties, hours = form.find('input[name=hours]'), notes = form.find('textarea[name=notes]'),
          project = form.find('select[name=project_id]'), task = form.find('select[name=task_id]');

      empties = [project, task, hours].filter(function(item, index, self) {
        if (!item.val()) { return true; }
      });

      if (empties.get('length')) {
        alert( this.I18n.t('form.empty', { field: empties.get('firstObject').attr('name').replace('_id', '').capitalize() }) );
        return false;
      }

      this.disableSubmit(form);
      data = this._xmlTemplateAdd({ hours: hours.val(), notes: notes.val(), project_id: project.val(), spent_at: Date('dd/mm/yyyy'), task_id: task.val() });
      this.request('postHours').perform(data);
    },

    _getRequest: function() {
      return {
        dataType: 'json',
        url:      this._proxyURL( this.resources.DAILY_URI.fmt(this.config.url) ),
        headers:      {
          'Authorization': 'Basic ' + Base64.encode('%@:%@'.fmt(this.config.username, this.config.password))
        }
      };
    },

    _postRequest: function(data) {
      return {
        dataType:     'xml',
        data:         data,
        processData:  false,
        type:         'POST',
        url:          this._proxyURL( this.resources.DAILY_ADD_URI.fmt(this.config.url) ),
        headers:      {
          'Authorization': 'Basic ' + Base64.encode('%@:%@'.fmt(this.config.username, this.config.password))
        }
      };
    },

    _proxyURL: function(resource) {
      return encodeURI(this.resources.PROXY_URI.fmt(resource));
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
    handleFailedRequest: function(event, jqXHR, textStatus, errorThrown) { debugger; this.showError( this.I18n.t('problem', { error: jqXHR.responseText }) ); },

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
