// Variables available for the script are
//    current - Current error record
//    count - Count of previous execution on the rule on the error record
//    rule - Rule record GR
//
// Following fields in rule can be modified
//    rule.u_action - Action to be performed on the error record
//       -1 - No Action
//         0 - Abort & End
//         7 - Abort
//         3 - Skip
//         4 - Retry
//
//    rule.u_delay - Delay in seconds
//    rule.u_retry_count - Retry count

function get_Auto_Data(cTask){
	var changeTask = new GlideRecord('change_task');
	changeTask.addQuery('number',cTask);
	changeTask.query();
	if(changeTask.next()){
		return changeTask.u_automation_data.getDisplayValue();
	}
}
var jobErrPattern = "Ansible Job did not complete.  Job status: failed";
var errDesc = current.description;
if(errDesc.includes(jobErrPattern)){
    var auto_data = get_Auto_Data(current.parent.getDisplayValue());
    if (auto_data.toLowerCase().includes('"jobname":"gcp deploy app infrastructure"')) {
        u_action = 7;
    } else {
        u_action = 4;
    }
}
// Do not change the following line as the script should always return the rule object
rule;