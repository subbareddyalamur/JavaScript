var role_u_action;
var AEerrors = new GlideRecord('u_aed_errors');
AEerrors.addQuery('number',current);
AEerrors.query();
while(AEerrors.next()) {
    if(AEerrors.cmdb_ci.name == 'Ansible Tower' && AEerrors.state == 1) {
        var cTask = AEerrors.parent.getDisplayValue();
        var changeTask = new GlideRecord('change_task');
        changeTask.addQuery('number',cTask);
        changeTask.query();
        while(changeTask.next()) {
            var auto_data = (changeTask.u_automation_data.getDisplayValue());
            if(auto_data.toLowerCase().includes('"jobname":"gcp deploy app infrastructure"')) {
                role_u_action = -1;
            }
            else {
                role_u_action = 4;
            }
        }    
    }
}
gs.print(role_u_action);