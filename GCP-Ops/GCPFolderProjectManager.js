var GCPFolderProjectManager = Class.create();
GCPFolderProjectManager.prototype = {
    initialize: function() {
        this.PLATFORM_UPDATE_TABLE = "x_sahr_gcpops_gcp_platform_upgrade_task";
        this.STATE_PENDING = 1;
        this.STATE_WORK_IN_PROGRESS = 2;
        this.STATE_CLOSED_COMPLETE = 3;
        this.STATE_CLOSED_FAILED = -1;
        this.STATE_CANCELLED = 4;
        this.TASK_REJECT_COUNT = gs.getProperty('x_sahr_gcpops.update_task_reject_count', 2);
    },

    _compareVersion: function(v1, v2) {
        if (typeof v1 !== 'string')
            return false;
        if (typeof v2 !== 'string')
            return false;
        v1 = v1.split('.');
        v2 = v2.split('.');
        var k = Math.min(v1.length, v2.length);
        for (var i = 0; i < k; ++i) {
            v1[i] = parseInt(v1[i], 10);
            v2[i] = parseInt(v2[i], 10);
            if (v1[i] > v2[i])
                return 1;
            if (v1[i] < v2[i])
                return -1;
        }

        return v1.length == v2.length ? 0 : (v1.length < v2.length ? -1 : 1);
    },

    _createTask: function(entity, workType, curArtifact, newArtifact, scheduledTime, shortDescription, parent, forceUpdate, leadTime, comments) {
        var moduleUpdateGr = new GlideRecord(this.PLATFORM_UPDATE_TABLE);
        moduleUpdateGr.initialize();
        moduleUpdateGr.state = this.STATE_PENDING;
        moduleUpdateGr.gcp_entity = entity;
        moduleUpdateGr.current_artifact = curArtifact;
        moduleUpdateGr.target_artifact = newArtifact;
        moduleUpdateGr.expected_start = scheduledTime;
        moduleUpdateGr.short_description = shortDescription;
        moduleUpdateGr.u_work_type = workType;
        moduleUpdateGr.close_notes = comments;
        if (!gs.nil(parent)) {
            moduleUpdateGr.parent = parent;
        }

        if (forceUpdate == "true") {
            moduleUpdateGr.approval = 'approved';
            if (!gs.nil(leadTime)) {
                var dueDateTime = new GlideDateTime();
                dueDateTime.addSeconds(leadTime * 60);
                moduleUpdateGr.due_date = dueDateTime;
            }
        } else
            moduleUpdateGr.approval = 'requested';

        var task = {};
        task.sysId = moduleUpdateGr.update();
        if (!gs.nil(task.sysId)) {
            task.number = moduleUpdateGr.number.toString();
        }

        return (task);
    },

    // can cancel only pending tasks

    _cancelTask: function(task, workNotes) {
        var retVal = false;

        var moduleUpdateGr = new GlideRecord(this.PLATFORM_UPDATE_TABLE);
        moduleUpdateGr.addEncodedQuery("active=true^state=" + this.STATE_PENDING + "^sys_id=" + task + "^ORnumber=" + task);

        moduleUpdateGr.query();
        if (moduleUpdateGr.next()) {
            moduleUpdateGr.state = this.STATE_CANCELLED;
            if (!gs.nil(workNotes)) {
                moduleUpdateGr.work_notes = workNotes;
            }
            retVal = gs.nil(moduleUpdateGr.update()) ? false : true;
        }

        return (retVal);
    },

    _getPendingTask: function(gcpEntity, curArtifact, NewArtifact) {
        var task = null;
        var moduleUpdateGr = new GlideRecord(this.PLATFORM_UPDATE_TABLE);
        moduleUpdateGr.addEncodedQuery("gcp_entity=" + gcpEntity + "^active=true");
        moduleUpdateGr.query();
        if (moduleUpdateGr.next()) {
            task = {};
            task.sysId = moduleUpdateGr.sys_id.toString();
            task.number = moduleUpdateGr.number.toString();
            task.curArtifact = moduleUpdateGr.current_artifact.toString();
            task.newArtifact = moduleUpdateGr.target_artifact.toString();
            task.due = moduleUpdateGr.due_date;
            task.approval = moduleUpdateGr.approval;
            task.gracePeriodEnd = moduleUpdateGr.expected_start;
        }

        return (task);
    },
    _getRejectedTaskCount: function(gcpEntity, targetArtifact) {
        var count = 0;
        var moduleUpdateGr = new GlideRecord(this.PLATFORM_UPDATE_TABLE);
        moduleUpdateGr.addEncodedQuery("gcp_entity=" + gcpEntity + "^target_artifact=" + targetArtifact);
        moduleUpdateGr.orderByDesc('sys_created_on');
        moduleUpdateGr.query();
        while (moduleUpdateGr.next()) {
            if (moduleUpdateGr.approval == 'rejected')
                count = count + 1;
            else
                break;
        }

        return count;
    },
	getRejectedCount: function(uTask)
	{
		return "TEST!@#";//_getRejectedTaskCount(uTask.gcp_entity.toString(),uTask.target_artifact.toString());
	},
    scheduleUpdates: function(forceUpdate, leadTime, comments) {
        var toolbox = new global.GCPCMDBToolbox();
        var shortDescription = "";
        var workType = "";
        var workDescription = "";
        var message = "";

        var graceDateTime = new GlideDateTime();

        graceDateTime.addDaysLocalTime(GCPOpsProperties.getGracePeriod());

        var folderProjectArtifactList = toolbox.getFolderProjectArtifactList();
        var curFolderArtifact = toolbox.getCurrentFolderArtifact();
        var curProjectArtifact = toolbox.getCurrentProjectArtifact();

        if (curFolderArtifact.version == "NONE" || curFolderArtifact.version == "MULTIPLE" ||
            curProjectArtifact.version == "NONE" || curProjectArtifact.version == "MULTIPLE") {

            // NEED TO FIGURE OUT WHO TO NOTIFIY WITH A TASK TO FIX BEFORE RERUNNING.

            gs.info("we have issues with current artifact for either folder or project");
            return;
        }

        for (var i in folderProjectArtifactList) {

            var folder = folderProjectArtifactList[i];
            var folderTask = this._getPendingTask(folder.sysId);

            // Check if we have a pending task that is different from what is current.  If so cancel it
            // This is cancel all children with BR.  might need to put a pause in for children to be cancelled.

            if (!gs.nil(folderTask)) {
                if ((folderTask.curArtifact !== folder.artifact) || (folderTask.newArtifact !== curFolderArtifact.sysId)) {
                    this._cancelTask(folderTask.sysId, "Cancelling due to change in current folder artifact.  Current version is now " + curFolderArtifact.version.toString());
                    folderTask = null;
                } else if (forceUpdate == "true") {
                    var dueDateTime = new GlideDateTime();
                    dueDateTime.addSeconds(leadTime * 60);
                    if (folderTask.approval != "approved" || (gs.nil(folderTask.due) && dueDateTime.compareTo(new GlideDateTime(folderTask.gracePeriodEnd)) < 0) || dueDateTime.compareTo(new GlideDateTime(folderTask.due)) < 0) {
                        this._cancelTask(folderTask.sysId, "Cancelling as another force update task is being scheduled.");
                        folderTask = null;
                    }
                }
            }

            if (!folderTask && (folder.artifact !== curFolderArtifact.sysId)) {
                workType = this._compareVersion(curFolderArtifact.version.toString(), folder.version.toString());
                workDescription = workType == -1 ? "Folder Rollback" : "Folder Update";

                shortDescription = workDescription + " for " + folder.folderName.toString() + " with platform module " + curFolderArtifact.name.toString() +
                    " from version " + folder.version.toString() + " to version " + curFolderArtifact.version.toString();
                if (forceUpdate != "true") {
                    var rcount = this._getRejectedTaskCount(folder.sysId, curFolderArtifact.sysId);
                    if (rcount >= this.TASK_REJECT_COUNT) {
                        folderTask = this._createTask(folder.sysId, workDescription, folder.artifact, curFolderArtifact.sysId, graceDateTime, shortDescription, null, "true", null, "Scheduling forced update task as the task was rejected " + rcount + " times already!");
                    } else {
                        folderTask = this._createTask(folder.sysId, workDescription, folder.artifact, curFolderArtifact.sysId, graceDateTime, shortDescription, null, forceUpdate, leadTime, comments);
                    }

                } else {
                    folderTask = this._createTask(folder.sysId, workDescription, folder.artifact, curFolderArtifact.sysId, graceDateTime, shortDescription, null, forceUpdate, leadTime, comments);
                }

                gs.info(folderTask.number + " scheduled. " + shortDescription);
            } else {
                message = "Skipping folder " + folder.folderName.toString() + ", ";
                message += folderTask ? folderTask.number + " has already been scheduled." : " already up to date.";

                gs.info(message);
            }

            for (var j in folderProjectArtifactList[i].projects) {

                var project = folderProjectArtifactList[i].projects[j];
                var projectTask = this._getPendingTask(project.sysId);

                // Check if we have a pending task that is different from what is current.  If so cancel it

                if (!gs.nil(projectTask)) {
                    if ((projectTask.curArtifact !== project.artifact) || (projectTask.newArtifact !== curProjectArtifact.sysId)) {
                        this._cancelTask(projectTask.sysId, "Cancelling due to change in current project artifact.  Current version is now " + curProjectArtifact.version.toString());
                        projectTask = null;
                    } else if (forceUpdate == "true") {
                        var pDueDateTime = new GlideDateTime();
                        pDueDateTime.addSeconds(leadTime * 60);
                        if (projectTask.approval != "approved" || (gs.nil(projectTask.due) && pDueDateTime.compareTo(new GlideDateTime(projectTask.gracePeriodEnd)) < 0) || pDueDateTime.compareTo(new GlideDateTime(projectTask.due)) < 0) {
                            this._cancelTask(projectTask.sysId, "Cancelling as another force update task is being scheduled.");
                            projectTask = null;
                        }
                    }
                }

                if (!projectTask && (folderTask || (project.artifact !== curProjectArtifact.sysId))) {
                    workType = this._compareVersion(curFolderArtifact.version.toString(), folder.version.toString());
                    workDescription = workType == -1 ? "Project Rollback" : "Project Update";

                    shortDescription = workDescription + " for " + project.projectName.toString() + " with platform module " + curProjectArtifact.name.toString() +
                        " from version " + project.version.toString() + " to version " + curProjectArtifact.version.toString();

                    var parent = folderTask ? folderTask.sysId : null;

                    if (forceUpdate != "true") {
                        var prcount = this._getRejectedTaskCount(project.sysId, curProjectArtifact.sysId);
                        if (prcount >= this.TASK_REJECT_COUNT) {
                            projectTask = this._createTask(project.sysId, workDescription, project.artifact, curProjectArtifact.sysId, graceDateTime, shortDescription, parent, "true", null, "Scheduling forced update task as the task was rejected " + prcount + " times already!");
                        } else {
                            projectTask = this._createTask(project.sysId, workDescription, project.artifact, curProjectArtifact.sysId, graceDateTime, shortDescription, parent, forceUpdate, leadTime, comments);
                        }

                    } else {
                        projectTask = this._createTask(project.sysId, workDescription, project.artifact, curProjectArtifact.sysId, graceDateTime, shortDescription, parent, forceUpdate, leadTime, comments);
                    }


                    gs.info(projectTask.number + " scheduled. " + shortDescription);
                } else {
                    message = "Skipping project " + project.projectName.toString() + ", ";
                    message += projectTask ? projectTask.number + " has already been scheduled." : " already up to date.";

                    gs.info(message);
                }
            }
        }
    },
    scheduleFolderUpdate: function(folderSysId, artifactSysId, forceUpdate, leadTime, comments) {

        var result = {
            msgs: [],
            task: ""
        };

        var toolbox = new global.GCPCMDBToolbox();

        var folder = new GlideRecord(toolbox.FOLDER_TABLE);
        folder.get(folderSysId);

        var curArtifact = this._getEntityArtifact(folderSysId);

        var updateArtifact = new GlideRecord(toolbox.ARTIFACT_TABLE);
        updateArtifact.get(artifactSysId);

        var folderTask = this._getPendingTask(folderSysId);

        if (!gs.nil(folderTask)) {
            if ((folderTask.curArtifact !== curArtifact.sysId) || (folderTask.newArtifact !== artifactSysId)) {
                this._cancelTask(folderTask.sysId, "Cancelling due to change in current folder artifact.  New version is now " + updateArtifact.version.toString());
                result.msgs.push("Cancelled folder update task " + folderTask.number + ".");
                folderTask = null;
            } else if (forceUpdate == "true") {
                var dueDateTime = new GlideDateTime();
                dueDateTime.addSeconds(leadTime * 60);
                if (folderTask.approval != "approved" || (gs.nil(folderTask.due) && dueDateTime.compareTo(new GlideDateTime(folderTask.gracePeriodEnd)) < 0) || dueDateTime.compareTo(new GlideDateTime(folderTask.due)) < 0) {
                    this._cancelTask(folderTask.sysId, "Cancelling as another force update task is being scheduled.");
                    result.msgs.push("Cancelled folder update task " + folderTask.number + ".");
                    folderTask = null;
                }
            }

        }

        if (!folderTask) {
            workType = this._compareVersion(updateArtifact.version.toString(), curArtifact.version.toString());
            workDescription = workType == -1 ? "Folder Rollback" : "Folder Update";

            shortDescription = workDescription + " for " + folder.name.toString() + " with platform module " + updateArtifact.name.toString() +
                " from version " + curArtifact.version.toString() + " to version " + updateArtifact.version.toString();
            var graceDateTime = new GlideDateTime();

            graceDateTime.addDaysLocalTime(GCPOpsProperties.getGracePeriod());
            folderTask = this._createTask(folder.sys_id, workDescription, curArtifact.sysId, artifactSysId, graceDateTime, shortDescription, null, forceUpdate, leadTime, comments);

            result.msgs.push("Created folder update task " + folderTask.number + ".");

        } else {
            result.msgs.push("Folder update task " + folderTask.number + " already exist.");
        }

        result.task = folderTask.sysId;
        return result;

    },

    scheduleProjectUpdate: function(projectSysId, artifactSysId, parentTask, forceUpdate, leadTime, comments) {

        var result = {
            msgs: [],
            task: ""
        };

        var toolbox = new global.GCPCMDBToolbox();

        var project = new GlideRecord(toolbox.PROJECT_TABLE);
        project.get(projectSysId);

        var curArtifact = this._getEntityArtifact(projectSysId);

        var updateArtifact = new GlideRecord(toolbox.ARTIFACT_TABLE);
        updateArtifact.get(artifactSysId);

        var projectTask = this._getPendingTask(projectSysId);

        if (!gs.nil(projectTask)) {
            if ((projectTask.curArtifact !== curArtifact.sysId) || (projectTask.newArtifact !== artifactSysId)) {
                this._cancelTask(projectTask.sysId, "Cancelling due to change in current project artifact.  New version is now " + updateArtifact.version.toString());
                result.msgs.push("Cancelled project update task " + projectTask.number + ".");
                projectTask = null;
            } else if (forceUpdate == "true") {
                var dueDateTime = new GlideDateTime();
                dueDateTime.addSeconds(leadTime * 60);
                if (projectTask.approval != "approved" || (gs.nil(projectTask.due) && dueDateTime.compareTo(new GlideDateTime(projectTask.gracePeriodEnd)) < 0) || dueDateTime.compareTo(new GlideDateTime(projectTask.due)) < 0) {
                    this._cancelTask(projectTask.sysId, "Cancelling as another force update task is being scheduled.");
                    result.msgs.push("Cancelled project update task " + projectTask.number + ".");
                    projectTask = null;
                }
            }
        }

        if (!projectTask) {
            workType = this._compareVersion(updateArtifact.version.toString(), curArtifact.version.toString());
            workDescription = workType == -1 ? "Project Rollback" : "Project Update";

            shortDescription = workDescription + " for " + project.name.toString() + " with platform module " + updateArtifact.name.toString() +
                " from version " + curArtifact.version.toString() + " to version " + updateArtifact.version.toString();
            var graceDateTime = new GlideDateTime();

            graceDateTime.addDaysLocalTime(GCPOpsProperties.getGracePeriod());
            projectTask = this._createTask(project.sys_id, workDescription, curArtifact.sysId, artifactSysId, graceDateTime, shortDescription, parentTask, forceUpdate, leadTime, comments);

            result.msgs.push("Created project update task " + projectTask.number + ".");

        } else {
            result.msgs.push("Project update task " + projectTask.number + " already exist.");
        }

        result.task = projectTask.sysId;
        return result;

    },

    _getEntityArtifact: function(entitySysId) {
        var artifact = null;
        var toolbox = new global.GCPCMDBToolbox();

        var relationshipGr = new GlideRecord(toolbox.RELATIONSHIP_TABLE);
        relationshipGr.addQuery("parent", entitySysId);
        relationshipGr.addQuery("type", toolbox.USES_RELATIONSHIP);
        relationshipGr.addQuery("child.sys_class_name", toolbox.ARTIFACT_TABLE);
        relationshipGr.query();
        if (relationshipGr.next()) {
            artifact = {};
            artifact.sysId = relationshipGr.child.toString();
            artifact.version = relationshipGr.child.version.toString();
        }

        return (artifact);
    },
    autoApproveUpdates: function() {

        var moduleUpdateGr = new GlideRecord(this.PLATFORM_UPDATE_TABLE);
        moduleUpdateGr.addQuery('approval', 'requested');
        moduleUpdateGr.addQuery('state', 1);
        moduleUpdateGr.addQuery('expected_start', "<=", new GlideDateTime());
        moduleUpdateGr.query();
        while (moduleUpdateGr.next()) {
            new global.WorkflowApprovalUtils().setAllApprovalsByTask(moduleUpdateGr, 'not_required', "Auto approving the task as the grace period ended");
            //moduleUpdateGr.approval='approved';
            //moduleUpdateGr.due_date=new GlideDateTime();
            moduleUpdateGr.close_notes = moduleUpdateGr.close_notes + "Auto approving the task as the grace period ended";
            moduleUpdateGr.work_notes = "Auto approving the task as the grace period ended";
            moduleUpdateGr.update();
        }

    },
    executeUpdates: function() {
        var batchSize = gs.getProperty('x_sahr_gcpops.update_batch_size', 8);
        var gr = new GlideRecord(this.PLATFORM_UPDATE_TABLE);
        gr.addQuery('state', this.STATE_WORK_IN_PROGRESS);
        gr.query();
		var count = gr.getRowCount();		
        if (count < batchSize) {
            var egr = new GlideRecord(this.PLATFORM_UPDATE_TABLE);
            egr.addQuery('state', this.STATE_PENDING);
			egr.addQuery('approval', 'approved');
			var now=new GlideDateTime();
			var eqr=egr.addQuery('expected_start','<=',now);
			eqr.addOrCondition('due_date','<=',now);
            egr.orderBy('u_work_type');
			egr.setLimit(batchSize - count);
            egr.query();
            while (egr.next()) {
                if (egr.u_work_type == GCPPlatformUpdateExectionManagerWFHelper.PROJECT_WORK_TYPE) {
                    if (egr.parent) {
                        if (egr.parent.state == this.STATE_WORK_IN_PROGRESS)
                            continue;
                    }
                }
                egr.state = this.STATE_WORK_IN_PROGRESS;
                egr.update();
            }
        }
    },
    type: 'GCPFolderProjectManager'
};