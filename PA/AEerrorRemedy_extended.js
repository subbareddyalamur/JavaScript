function get_Auto_Data(cTask){
	var changeTask = new GlideRecord('change_task');
	changeTask.addQuery('number',cTask);
	changeTask.query();
	if(changeTask.next()){
		auto_data = (changeTask.u_automation_data.getDisplayValue());
		return auto_data;
	}
}

var invErrPattern = "Error creating inventory";
var jobLaunchPattern = "Failed to launch job ";
var jobErrPattern = "Ansible Job did not complete.  Job status: failed";
var u_action;
var AEerror = new GlideRecord('u_aed_errors');
AEerror.addQuery('number','AE_ERR0019473');
AEerror.query();
if(AEerror.next()){
	if(AEerror.toLowerCase().includes(invErrPattern) || AEerror.toLowerCase().includes(jobLaunchPattern)){
		gs.print(AEerror.parent.getDisplayValue());
		u_action = 4;
		var auto_data = get_Auto_Data(AEerror.parent.getDisplayValue());
		gs.print(auto_data);
		if (auto_data.toLowerCase().includes('"jobname":"gcp deploy app infrastructure"')) {
			u_action = 7;
		} else {
			u_action = -1;
		}
	}
}
