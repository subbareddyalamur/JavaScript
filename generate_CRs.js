// Generate Patch Automation Changes
//
// Run: Daily
// Run as: AEDFUNC
// When to run: 5:15

(function () {

	var log = new AE_Log();
	var aeRunningLock = new AE_Running_Lock();
	var scriptName = 'Generate PA CRs';
	var notAlreadyLocked = false;

	try {
		notAlreadyLocked = aeRunningLock.setLock(scriptName);
		if (notAlreadyLocked && gs.getProperty('aed.change.generate', false) == "true") {
			var changeGenerator = new AE_GenerateChanges();
			var moreToDo = changeGenerator.generatePipelines("NOPROD");
			if (!moreToDo) {
				changeGenerator = new AE_GenerateChanges();
				changeGenerator.generatePipelines();
			}
		}
	} catch (exception) {
		log.exception(exception);
	} finally {
		if (notAlreadyLocked) {
			aeRunningLock.clearLock(scriptName);
		}
	}

})();
