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

var invErrPattern = "Error creating inventory";
var jobLaunchPattern = "Failed to launch job ";

var errDesc = current.description;
if(errDesc.includes(invErrPattern) || errDesc.includes(jobLaunchPattern)){
    rule.u_action = 4;
}
// Do not change the following line as the script should always return the rule object
rule;