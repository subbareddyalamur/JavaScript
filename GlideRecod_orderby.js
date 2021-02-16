var incidentGR = new GlideRecord('incident');
incidentGR.orderBy('short_description');
incidentGR.query();
while(incidentGR.next()){
    gs.print(incidentGR.number + ' : ' + incidentGR.short_description)
}