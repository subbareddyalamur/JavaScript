var newIncidents = [];
var counter = 1;
var incidentGR = new GlideRecord('incident');
while(counter <=5) {
    incidentGR.newRecord();
    incidentGR.short_desscription = 'Incident #'+ counter;
    counter++;
    newIncidents.push(incidentGR.insert());
}
gs.print(newIncidents);