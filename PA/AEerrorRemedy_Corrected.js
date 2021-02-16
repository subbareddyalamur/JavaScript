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

var cTask = current.parent.getDisplayValue();
var changeTask = new GlideRecord('change_task');
changeTask.addQuery('number', cTask);
changeTask.query();
if (changeTask.next()) {
	var auto_data = (changeTask.u_automation_data.getDisplayValue());
	if (auto_data.toLowerCase().includes('"jobname":"gcp deploy app infrastructure"')) {
		rule.u_action = -1;
	}
}

// Do not change the following line as the script should always return the rule object
rule;