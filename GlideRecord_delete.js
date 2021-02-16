var incidentGR = new GlideRecord('incident');
incidentGR.addQuery('short_description','Incident #1');
incidentGR.query();
while(incidentGR.next()){
    incidentGR.deleteRecord();
}