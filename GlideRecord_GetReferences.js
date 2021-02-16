var tasks = new GlideRecord('sc_task');
tasks.addQuery('number','TASK0000001');
tasks.query();
while(tasks.next()) {
    // Task form has field 'Request Item'. To get req item number use below code. tasks.request_item give sys_id, getDisplayValue() give display value in that field.
     gs.print(tasks.request_item.getDisplayValue())
}




var tasks = new GlideRecord('change_task');
tasks.addQuery('number','CTASK0010001');
tasks.query();
while(tasks.next()) {
     gs.print(tasks.change_request.getDisplayValue());
}
