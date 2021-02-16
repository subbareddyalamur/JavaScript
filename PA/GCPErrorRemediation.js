var AEerrors = new GlideRecord('u_aed_errors');
AEerrors.addQuery('cmdb_ci.name', 'Ansible Tower');
AEerrors.addQuery('state',1);
AEerrors.query();
var counter = 0
while(AEerrors.next()) {
     //gs.print(AEerrors.number + " - " + AEerrors.parent.getDisplayValue());
     counter++
     //gs.print(AEerrors.cmdb_ci.getDisplayValue())
     var output = isGCPorNot(AEerrors.parent.getDisplayValue());
     gs.print(output);
}
//gs.print(counter)

function isGCPorNot(cTask) {
    var changeTask = new GlideRecord('change_task');
    changeTask.addQuery('number',cTask);
    changeTask.query();
    while(changeTask.next()) {
         //gs.print(changeTask.u_automation_data.getDisplayValue());
         var result = (changeTask.u_automation_data.getDisplayValue());
         //gs.print(result)
         if(result.toLowerCase().includes('"jobname":"gcp deploy app infrastructure"')) {
             return -1;
         }
         else {
             return 4;
         }
     }
}