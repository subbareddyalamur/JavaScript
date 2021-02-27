var gr = new GlideRecord('incident');
//gr.addQuery('number','INC0010112');
gr.query();
var startTime = new GlideDateTime('2020-08-01 00:00:00');
var endTime = new GlideDateTime('2020-08-30 00:00:00');
while(gr.next()) {
    if (gr.opened_at > startTime && gr.opened_at < endTime) {
        gs.print(gr.number + " is opened at " + gr.opened_at);
    }
}