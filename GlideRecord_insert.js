var newIncident = new GlideRecord('incident');
newIncident.newRecord();
newIncident.short_description = "This incident was created from a background script";
var newIncidentSysID = newIncident.insert();
gs.print(newIncidentSysID)