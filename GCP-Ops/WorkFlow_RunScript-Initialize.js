// Set Workflow Context
var toolbox = new global.GCPCMDBToolbox();
var wfContextGr = new GlideRecord("wf_context");
if ( wfContextGr.get("id", current.sys_id.toString()) ) {
	current.workflow_context = wfContextGr.sys_id.toString();
}

var environment = "";
activity.result = "unknown";
var messages = [];

if ( current.gcp_entity.sys_class_name.toString() == "cmdb_ci_resource_group") {
	activity.result = "folder";
	environment = current.gcp_entity.name.toString().match(/^([a-z]+)-/)[1];
} else if ( current.gcp_entity.sys_class_name.toString() == "cmdb_ci_cloud_service_account") {
	activity.result = "project";
    environment = current.gcp_entity.name.toString().match(/^sab-(.*?)-.*$/)[1];
} else {
	messages.push("Error: Unable to determine if GCP Entity is a Folder or Project");
}

// Setup Common Change Info

workflow.scratchpad.ticket = current.number.toString();
workflow.scratchpad.requesterSysID = current.gcp_entity.owned_by.sys_id.toString();
workflow.scratchpad.datacenter = GCPOpsProperties.getTowerDatacenter();
workflow.scratchpad.ciSysID = GCPOpsProperties.getChangePrimaryCI();

var env = new GlideRecord('cmdb_ci_environment');
if (!env.get(toolbox._environmentFolderToChangeEnvironment(environment))) {
	messages.push("Error: Unable to determine environment for " + current.gcp_entity.name.toString());
    activity.result = "unknown";
} else {
	workflow.scratchpad.environment = env.getDisplayValue();
}


if ( messages.length > 0 ) {
	var msg = "";
	for (var i in messages) {
	   msg = msg.length > 0 ? msg + "\n" + messages[i] : messages[i];
	}
	 
	current.work_notes = msg;
}