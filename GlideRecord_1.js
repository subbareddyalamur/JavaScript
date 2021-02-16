var incidentGR = new GlideRecord('incident');
incidentGR.addQuery('priority',1);
incidentGR.query();
while(incidentGR.next()) {
    gs.print('Priority 1 incident: '+incidentGR.number+ ' : '+ incidentGR.priority);
}
