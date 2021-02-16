gs.include("AE_Log_Incident");
gs.include("AE_Global");
gs.include("AE_Utility");

var AE_GenerateChanges = Class.create();

AE_GenerateChanges.prototype = {
	initialize: function() {

		this.noCadence = false;
		this._log = new AE_Log_Incident("GenerateChanges");
		this._util = new AE_Utility();

		this.systems = { };   // track processed Systems
		this.excluded = { };  // track excluded Systems
		this.scheduled = { }; // Systems that already have a pending change request at the beginning of this run.
		this.changes = { };  // changes that are pending.
		this.pipelines = { };

		this.nodesetSorter = [ ];
		this.pipelineSorter = [ ];
		this.ts_relation_cache = [ ];
		this.ns_relation_cache = [ ];

		// ENUMs for arrays
		this.column = {
			TSNAME: 0,
			NSLIST: 0,
			NSNAME: 1,
			NODELIST: 1,
			DELAY: 2,
			TOTALDELAY: 3,
			BATCHSIZE: 4,
			CYCLETIME: 5,
			PREDLIST: 6,
			SEQUENCE: 7
		};

		if (gs.getProperty('aed.change.nocadence', false) == "true") this.noCadence = true;
		this.linuxRelease = gs.getProperty('aed.patchBundle', "Error Target Release Not Defined");
		this.smdcLinuxRelease = gs.getProperty('aed.smdc.patchBundle', "Error Target Release Not Defined");
		this.linuxReleaseDuration = parseInt(gs.getProperty('aed.patchBundle.duration', "15"));

		this.windowsRelease = gs.getProperty('aed.windowsPatchBundle', "Error Target Release Not Defined");
		// -*- V73 added to have separate patch labels for Sabre & DXC windows
		this.smdcWindowsRelease = gs.getProperty('aed.smdc.windowsPatchBundle', "Error Target Release Not Defined");
		
		this.windowsReleaseDuration = parseInt(gs.getProperty('aed.windowsPatchBundle.duration', "15"));

		// calculation for lead time needs hours, we use 9 hours as hour business day duration 08:00 to 17:00
		// so 3 days would be 9 * 3 .  then convert that to seconds
		this.leadTime = parseInt(gs.getProperty('aed.change.lead_time', "3")) * 9 * 3600;

		// This used globaly to consider HP maintenance for HPSA
		this.excludeDOW = parseInt(gs.getProperty('aed.change.hp.block', "0 none"));

		// This is used globaly to limit the duration of a change
		this.maxDuration = parseInt(gs.getProperty('aed.change.maxDuration', "6")) * 3600;

		// This is used globaly to add time to each change as a contengency
		this.contengency = parseInt(gs.getProperty('aed.change.contengency', "1")) * 3600;

		this.csv = true;
		this.maxBatchNodes = parseInt(gs.getProperty('aed.maxBatchNodeCount', 50));
		this.maxSNOWBatchNodes = parseInt(gs.getProperty('aed.maxSNOWBatchNodeCount', 50));
		this.maxNewChanges = parseInt(gs.getProperty('aed.scheduleChangeLimit', 0));
		this.scheduleUtil = new AE_ScheduleUtil(this.maxBatchNodes);
		this.scheduleUtilSNOW = new AE_ScheduleUtil(this.maxSNOWBatchNodes);
		//this.operatorGroup = AE_Global.getRecordID('sys_user_group', "Sabre Automation Operators");
		
		// -*- V35 Adding contingency time for each batch, converting minutes to seconds
		this.batchContingencySeconds=parseInt(gs.getProperty('aed.batch.contingency',10)) * 60;
	},
	byParent: function(a, b) {
		var parent = 0;
		var child = 1;
		var p1 = a[parent];
		var p2 = b[parent];
		var c1 = a[child];
		var c2 = b[child];

		if (p1 < p2) return -1;
			if (p1 > p2) return 1;
			if (c1 < c2) return -1;
			if (c1 > c2) return 1;

		return 0;
	},
	//************************************************************
	//
	// This debugging utility function will printout the contents
	// of the nodesetsorter array
	//
	//************************************************************
	printOutNodesetSorter: function() {
		var preLog = "NodeSetSorter - ";

		// seperate debug logging into sections.
		if (this._log.getLevel() == AE_Log.TRACE) {
			this._log.trace(preLog + " ");
			this._log.trace(preLog + "========================================================================");
			this._log.trace(preLog + " ");

			if (this.csv) this._log.trace(preLog + "Technical Service,Nodeset,Delay,Total Delay,Batch Size,Predecessors,Sequence Number");
				// iterate through finished array and print out contents.
			for (var myrow = 0; myrow < this.nodesetSorter.length; myrow++) {
				if (this.csv) {
					this._log.trace(preLog + this.nodesetSorter[myrow][this.column.TSNAME] + "," +
					this.nodesetSorter[myrow][this.column.NSNAME] + "," +
					this.nodesetSorter[myrow][this.column.DELAY] + "," +
					this.nodesetSorter[myrow][this.column.TOTALDELAY] + "," +
					this.nodesetSorter[myrow][this.column.BATCHSIZE] + "," +
					this.nodesetSorter[myrow][this.column.CYCLETIME] + "," +
					this.nodesetSorter[myrow][this.column.PREDLIST] + "," +
					this.nodesetSorter[myrow][this.column.SEQUENCE]);
				} else {
					this._log.trace(preLog + "===================");
					this._log.trace(preLog + "Technical Service = " + this.nodesetSorter[myrow][this.column.TSNAME]);
					this._log.trace(preLog + "Node Set Name     = " + this.nodesetSorter[myrow][this.column.NSNAME]);
					this._log.trace(preLog + "Duration          = " + this.nodesetSorter[myrow][this.column.DELAY]);
					this._log.trace(preLog + "Total Duration    = " + this.nodesetSorter[myrow][this.column.TOTALDELAY]);
					this._log.trace(preLog + "Batch Size        = " + this.nodesetSorter[myrow][this.column.BATCHSIZE]);
					this._log.trace(preLog + "CycleTime         = " + this.nodesetSorter[myrow][this.column.CYCLETIME]);
					this._log.trace(preLog + "Predecessor NS    = " + this.nodesetSorter[myrow][this.column.PREDLIST]);
					this._log.trace(preLog + "Sequence          = " + this.nodesetSorter[myrow][this.column.SEQUENCE]);
				}
			}
		}
	},
	//************************************************************
	//
	// This utility function is passed as an argument to sorting
	// the nodesetsorter in the order of technical service name
	// then sequence.total computed delay
	//
	//************************************************************
	byTechnicalService: function(a, b) {
		var technicalServiceName = 0;
		var delay = 2;
		var sequence = 7;

		var ts1 = a[technicalServiceName].toLowerCase();
		var ts2 = b[technicalServiceName].toLowerCase();
		var seq1 = a[sequence];
		var seq2 = b[sequence];
		var del1 = a[delay];
		var del2 = b[delay];

		if (ts1 < ts2) return -1;
			if (ts1 > ts2) return 1;
			if (seq1 < seq2) return -1;
			if (seq1 > seq2) return 1;
			if (del1 < del2) return -1;
			if (del1 > del2) return 1;

		return 0;
	},
	//************************************************************
	//
	// This utility function is passed as an argument to sorting
	// the nodesetsorter in the order of total computed delay
	//
	//************************************************************
	bytotalDelay: function(a, b) {
		var totalDelay = 3;
		var delay1 = a[totalDelay];
		var delay2 = b[totalDelay];

		if (delay1 < delay2) return -1;
			if (delay1 > delay2) return 1;
			return 0;
	},


	//************************************************************
	//
	// This initialization function will create a collection of
	// servers that should be excluded from scheduling for one reason
	// of another.
	//
	//************************************************************
	initializeExcludedSystems: function() {
		// first populate collection with systems that are explicitly blacklisted.
		var blackList = new GlideRecord('u_server_automation_blacklist');
		blackList.query();
		while (blackList.next()) {
			// just need one in collection to be useful
			if (this.excluded[blackList.u_server.toString()]) continue;
			this.excluded[blackList.u_server.toString()] = [ blackList.u_server.name.toString(), blackList.u_node_sets.name.toString(), blackList.u_reason.toString(),1 ];
			
		}
	},

	//************************************************************
	//
	// This initialization function will create a collection of
	// nodesets and order them in sequence for processing.   They
	// are ordered so that nodesets with prerequisits occur after
	// the dependency.  The pipelines will be processed using this
	// order so dependencies will be scheduled first.
	//
	//************************************************************
	initializeNodesetSorter: function(filterOnThis) {
		var preLog = "initializeNodesetSorter - ";
		var col = {
			PARENT: 0,
			CHILD: 1,
			EXCEPTION: 2,
			REASON: 3
		};
		var duration = 0;
		var appCycleTime = 0;
		var durationInHours = 0;
		var nodesetName = "";
		var order = 0;
		var parentName = "";

		this.initializeExcludedSystems();

		var relation = new GlideRecord('cmdb_rel_ci');
		var addOr1 = relation.addQuery('parent.sys_class_name', "u_node_sets");
		addOr1.addOrCondition('child.sys_class_name', "u_node_sets");

		relation.query();

		var nodeRecordCount = 0;
		var nodesetCount = 0;
		var referenceType = 'none';
		
		// does filter argument exist 
		if (filterOnThis != "") {
			// is it a nodeset?
			var nsTable = new GlideRecord('u_node_sets');
			nsTable.addQuery('name', filterOnThis);
			nsTable.query();
			if (nsTable.next()) {
				referenceType = 'node set';
			} else {
				var tsTable = new GlideRecord('u_cmdb_ci_technical_service');
				tsTable.addQuery('name', filterOnThis);
				tsTable.query();
				if (tsTable.next()) {
					referenceType = 'technical service';
				}				
			}			
		}

		// create our own in memory relation list for faster processing .
		while (relation.next()) {
			if ((relation.type.name == AE_Global.NODE_SET_2_TECHNICAL_SERVICE_RELATIONSHIP) &&
				(relation.child.sys_class_name == "u_node_sets")) {
				// if we have specified only one nodeset or technical service dont bother even looking at the others
				if (filterOnThis != "") {
					if (referenceType == "node set") {
						if (filterOnThis != relation.child.name.toString()) continue;
					} else {
						if (referenceType == "technical service") {
							if (filterOnThis != relation.parent.name.toString()) continue;
						}
					}					
				}
				// make sure nodeset is enabled for automation.
				if ((!isNaN(parseInt(relation.child.u_maturity))) &&
					((!relation.child.u_automated_patching_disabled) && (parseInt(relation.child.u_maturity) > 20))) {
					var tsRelationElement = [ relation.parent.name.toString(), relation.child.name.toString(), false, "" ];
					nodesetCount++;
					this.ts_relation_cache.push(tsRelationElement);
				}
				else
					{
						 var excludeStr="Nodeset is not enabled";
				if((isNaN(parseInt(relation.child.u_maturity))) ||  (parseInt(relation.child.u_maturity) <= 20) )
					excludeStr="Nodeset's maturity is less than expected";
				else if ((relation.child.u_automated_patching_disabled))
					excludeStr="Nodest has be disabled from automated patching by admin (" +	relation.child.u_automation_disabled_reason +")";
						this._log.debug(preLog + "Nodeset:" + relation.child.name + " excluded because:" +  excludeStr  ,'',relation.child.name,'nodeset-excluded');
						
					}
			} else if ((relation.type.name == AE_Global.SERVER_2_NODE_SET_RELATIONSHIP) && (relation.parent.sys_class_name == "u_node_sets")) {
				// if we have specified only one nodeset or technical service dont bother even looking at the others				
				if (filterOnThis != "") {
					if (referenceType == "node set") {
						if (filterOnThis != relation.parent.name.toString()) continue;
					} else {
						if (referenceType == "technical service") {
							var nsRef = relation.parent.getRefRecord();
							if (filterOnThis != nsRef.u_technical_service.name.toString()) {
								continue;
							}
						}						
					}					
				}
				
				// make sure nodeset is enabled for automation.
				if ((!isNaN(parseInt(relation.parent.u_maturity))) &&
					((!relation.parent.u_automated_patching_disabled) && (parseInt(relation.parent.u_maturity) > 20))) {
					if ((relation.parent.name.toString() != "") && (relation.child.name.toString() != "")) {
						var nsRelationElement = [ relation.parent.name.toString(), relation.child.name.toString(), relation.child.sys_id.toString() ];
						nodeRecordCount++;
						this.ns_relation_cache.push(nsRelationElement);
					}
				}
			}
		}

		this.ts_relation_cache.sort(this.byParent);
		this.ns_relation_cache.sort(this.byParent);

		// process all of our nodes sets defined in our database.
		var nodeSets = new GlideRecord("u_node_sets");
		nodeSets.query();

		while (nodeSets.next()) {
			// make sure nodeset is not ignored .
			// -*- dls v47 ignore cadence 
			if (parseInt(nodeSets.u_maturity) === 10) {
				continue;
			}
			
			// make sure nodeset is enabled for automation.			
			if ((isNaN(parseInt(nodeSets.u_maturity))) ||
				(nodeSets.u_automated_patching_disabled) ||
				(nodeSets.u_exception) || (parseInt(nodeSets.u_maturity) <= 20)) {
				var reasonStr="Nodeset is not enabled";
				if((isNaN(parseInt(nodeSets.u_maturity))) ||  (parseInt(nodeSets.u_maturity) <= 20) )
					reasonStr="Nodeset's maturity is less than expected";
				else if ((nodeSets.u_automated_patching_disabled))
					reasonStr="Nodest has be disabled from automated patching by admin (" +	nodeSets.u_automation_disabled_reason +")";
				else if((nodeSets.u_exception))
					reasonStr="Nodeset has been disabled from change automation ("+nodeSets.u_reason+")";
				
				
				var relatedSystems = new GlideRecord("cmdb_rel_ci");
				relatedSystems.addQuery("parent", nodeSets.sys_id);
				relatedSystems.query();
				reasonStr+=" ( " + relatedSystems.getRowCount() + " servers excluded )";
				while (relatedSystems.next()) {
					if (this.excluded[relatedSystems.child.toString()]) continue;
					this.excluded[relatedSystems.child.toString()] = [ relatedSystems.child.name.toString(), relatedSystems.parent.name.toString(), reasonStr,0 ];
				}
				continue;
			}

			var batchSize = nodeSets.u_batch_size + 0;
			var limitedNodeSize = 0;
			var nodeRows = 0;
			var exception = false;
			var reason = "";
			var limitedNodeList = "";

			nodesetName = nodeSets.name.toString();

			// get Technical Service Parent if one exist.
			for (var i = 0; i < this.ts_relation_cache.length; ++i) {
				if (this.ts_relation_cache[i][col.CHILD] == nodesetName) {
					parentName = this.ts_relation_cache[i][col.PARENT];
					// update exception flags if needed.
					if (nodeSets.u_exception == true) {
						this.ts_relation_cache[i][col.EXCEPTION] = true;
						exception = true;
						this.ts_relation_cache[i][col.REASON] = nodeSets.u_reason.toString();
						reason = nodeSets.u_reason.toString();
					}
					break;
				}
			}

			// to compute the number of nodes for batchsize from ratio we need to
			// Calculate the number of nodes in this set
			for (var j = 0; j < this.ns_relation_cache.length; ++j) {
				// collection should be sorted by nodeset name. take shortcut if we can.
				if (this.ns_relation_cache[j][col.PARENT] < nodesetName) continue;
					// filter for current nodeset
				else if (this.ns_relation_cache[j][col.PARENT] == nodesetName) {
					nodeRows++;
					continue;
				}
				// structure is sorted by nodeset name .. so get out of loop if get here.
				else break;
				}

			if (nodeRows == 0) continue;

			// if batch ratio field is > 0 then we need to compute the batch size
			// as a percentage of the total nodeset population
			if (nodeSets.u_batch_ratio > 0) {
				batchSize = parseInt(Math.max((nodeRows * nodeSets.u_batch_ratio), 1));
			}

			appCycleTime = nodeSets.u_application_cycle_time.getGlideObject().getNumericValue() / 1000;
			duration = nodeSets.u_delay_interval.getGlideObject().getNumericValue();
			order = nodeSets.u_execution_order + 0;

			switch (nodeSets.u_first_night_type.toString()) {
				case "n/a":
				this._log.trace(preLog + "Type n/a :" + nodeSets.name);
				break;
				case "size":
				limitedNodeSize = nodeSets.u_first_night_size;
				this._log.trace(preLog + "Type Size :" + nodeSets.name + ":" + limitedNodeSize);
				break;
				case "ratio":
				// if limited node ratio field is > 0 then we need to compute the limited node size
				// as a percentage of the total nodeset population
				if (nodeSets.u_first_night_ratio > 0) {
					if (nodeSets.u_first_night_ratio < 1) {
						limitedNodeSize = parseInt(Math.max((nodeRows * nodeSets.u_first_night_ratio), 1));
					} else {
						limitedNodeSize = parseInt(nodeSets.u_first_night_ratio);
					}
				}
				this._log.trace(preLog + "Type Ratio :" + nodeSets.name + ":" + limitedNodeSize);
				break;
				case "List":
				var listCount = new GlideRecord('u_m2m_servers_node_sets');
				listCount.addQuery('u_node_sets', nodeSets.sys_id);
				listCount.query();

				while (listCount.next()) {
					limitedNodeList = limitedNodeList.concat(listCount.u_server.name, " ");
					limitedNodeSize++;
				}
				this._log.trace(preLog + "Type List :" + nodeSets.name + ":" + limitedNodeList + ":" + limitedNodeSize);
				break;
				default:
				this._log.trace(preLog + "Type undefined :" + nodeSets.name + ":" + nodeSets.u_first_night_type);
			}

			// if limited nodesize is 0 or somehow greater than the total number of systems then it is not really limited is it.
			if ((limitedNodeSize > 0) && (limitedNodeSize < nodeRows)) {
				// we need to manipulate the relationship cache to create
				// a node set for a limited node collection.
				var limitedName = "LimitedNodes-" + nodesetName;
				var relationElement2 = [ parentName, limitedName, exception, reason ];
				this.ts_relation_cache.push(relationElement2);

				// now move the child nodes. for limited nodes size.
				for (var k = 0, moved = 0; (k < this.ns_relation_cache.length) && (moved < limitedNodeSize); ++k) {
					// filter for current nodeset
					if (this.ns_relation_cache[k][col.PARENT] == nodesetName) {
						// if limited node type is 'list' then make sure we filter system list.
						if (nodeSets.u_first_night_type.toString() == "List") {
							// if the chile relationship is not in the limited node list then search for more
							if (limitedNodeList.indexOf(this.ns_relation_cache[k][col.CHILD]) == -1) {
								continue;
							}
						}
						// if server already scheduled then skip this system
						if (this.scheduled[this.ns_relation_cache[k][col.CHILD]]) {
							// one of the servers are already scheduled so decrement the total nodes needed for this limited node change.
							limitedNodeSize--;
							continue;
						}

						this.ns_relation_cache[k][col.PARENT] = limitedName;
						moved++;
					}
				}
				
				// Only create limited nodes record if we moved related servers to group.
				if (moved > 0 ) {
					// add limted nodes row to sorter.
					// convert the delay interval into hours.
					durationInHours = (duration / 1000) / (60 * 60);
					// Create a new row and populate with node set data
					var nodesetRowLimited = [ parentName, limitedName,
					durationInHours + 0, durationInHours + 0,
					batchSize + 0, appCycleTime + 0, "", order-1 ];
					this.nodesetSorter.push(nodesetRowLimited);

					// reset remaining nodes columns with modified values .
					// set delay to first night delay value.
					duration = nodeSets.u_first_night_delay.getGlideObject().getNumericValue();
				}
			}

			// convert the delay interval into hours.
			durationInHours = (duration / 1000) / (60 * 60);
			// Create a new row and populate with node set data
			var nodesetRow = [ parentName, nodesetName,
			durationInHours + 0, durationInHours + 0,
			batchSize + 0, appCycleTime + 0, "", order ];
			this.nodesetSorter.push(nodesetRow);
		}

		// we may have added some rows .  lets resort.
		this.ts_relation_cache.sort(this.byParent);
		this.ns_relation_cache.sort(this.byParent);

		this.printOutNodesetSorter();

		// The execution order is a relative sequence number in the context of nodes sets owned by
		// a technical service.  so this collection need to be sorted by technical service to establish
		// interdependenies between nodesets
		this.nodesetSorter.sort(this.byTechnicalService);

		this.printOutNodesetSorter();

		// now that the table is sorted by technial service and sequence.   we can total delay intervals

		// check for total array length
		var myrow = 0;
		for (myrow = 1; myrow < this.nodesetSorter.length; myrow++) {
			// is the previous row the same technical service
			if (this.nodesetSorter[myrow][this.column.TSNAME] ==
				this.nodesetSorter[myrow - 1][this.column.TSNAME]) {

				if (this.nodesetSorter[myrow][this.column.SEQUENCE] >
					this.nodesetSorter[myrow - 1][this.column.SEQUENCE]) {
					// add previous values to my delay.
					this.nodesetSorter[myrow][this.column.TOTALDELAY] =
					this.nodesetSorter[myrow][this.column.DELAY] +
					this.nodesetSorter[myrow - 1][this.column.TOTALDELAY];
				} else {
					// compute running totals if sequence is same
					this.nodesetSorter[myrow][this.column.TOTALDELAY] =
					this.nodesetSorter[myrow - 1][this.column.TOTALDELAY] -
					this.nodesetSorter[myrow - 1][this.column.DELAY] +
					this.nodesetSorter[myrow][this.column.DELAY];
				}
			}
		}

		this.printOutNodesetSorter();

		// while we are here go ahead and store the immediate node precedent
		// we are going to need it later
		for (myrow = this.nodesetSorter.length - 1; myrow > 0; myrow--) {
			var predNodeSetName = "";
			var seq = -1;
			var currentNodeSetName = this.nodesetSorter[myrow][this.column.NSNAME];
			
			for (var subrow = 1; subrow <= myrow; subrow++) {
				// do the neighboring rows belong to the same technical service ?
				if (this.nodesetSorter[myrow][this.column.TSNAME] ==
					this.nodesetSorter[myrow - subrow][this.column.TSNAME]) {
					// is the current row sequence greater than the neighboring row
					if (this.nodesetSorter[myrow][this.column.SEQUENCE] >
						this.nodesetSorter[myrow - subrow][this.column.SEQUENCE]) {
						// is this the first neighbor that is less than the current row
						predNodeSetName = this.nodesetSorter[myrow - subrow][this.column.NSNAME];
						
						// is predecessor from a limited nodes configuration 
						if(predNodeSetName.contains("LimitedNodes-")) {
							// yes,  is it a predecessor to the current nodeset ?
							if (!predNodeSetName.contains(currentNodeSetName.toString())) {	
								// No,  then it is not a real predessor ,  next ....
								break;
							}
						}
						
						if (seq == -1) {
							// initialize current row predesessor list with the neighboring row
							seq = this.nodesetSorter[myrow - subrow][this.column.SEQUENCE];
							this.nodesetSorter[myrow][this.column.PREDLIST] = predNodeSetName.toString();
						} else {
							// is the sequence value the same as last iteration through loop
							if (this.nodesetSorter[myrow - subrow][this.column.SEQUENCE] == seq) {
								// Concatenate to create a list
								var concatString = this.nodesetSorter[myrow][this.column.PREDLIST];
								this.nodesetSorter[myrow][this.column.PREDLIST] = concatString.concat("^", predNodeSetName.toString());
							} else {
								// end of neighbor predecessor list
								break;
							}
						}
					}
				} else {
					break;
				}
			}
		}

		this.printOutNodesetSorter();

		// now that we have updated the total delay for each node set .. lets sort them to the the final order.
		this.nodesetSorter.sort(this.bytotalDelay);

		// Validate table was populated and sorted as requested.
		this.printOutNodesetSorter();
	},
	// utility to print out the contents of the pipelineSorter Array.
	printOutPipelineSorter: function() {

		var preLog = "PipelineSorter - ";

		// seperate debug logging into sections.
		if (this._log.getLevel() == AE_Log.TRACE) {
			this._log.trace(preLog + " ");
			this._log.trace(preLog + "========================================================================");
			this._log.trace(preLog + " ");

			// iterate through finished array and print out contents.

			for (var myrow = 0; myrow < this.pipelineSorter.length; myrow++) {
				this._log.trace(preLog + "===================");
				this._log.trace(preLog + "Node Set List     = " + this.pipelineSorter[myrow][this.column.NSLIST]);
				this._log.trace(preLog + "Node Name List    = " + this.pipelineSorter[myrow][this.column.NODELIST]);
				this._log.trace(preLog + "Duration          = " + this.pipelineSorter[myrow][this.column.DELAY]);
				this._log.trace(preLog + "Total Duration    = " + this.pipelineSorter[myrow][this.column.TOTALDELAY]);
				this._log.trace(preLog + "Batch Size        = " + this.pipelineSorter[myrow][this.column.BATCHSIZE]);
				this._log.trace(preLog + "Cycle Time        = " + this.pipelineSorter[myrow][this.column.CYCLETIME]);
				this._log.trace(preLog + "Predecessor List  = " + this.pipelineSorter[myrow][this.column.PREDLIST]);
			}
		}
	},
	//************************************************************
	//
	// Compile systems into groups that contain other systems
	// that share the same node set parent relationships.
	// This is important as we wamt pipelines to contain systems
	// with identical attributes.
	//
	//************************************************************
	addHostToPipelineGroup: function(node, node_sysid) {
		var col = {
			PARENT: 0,
			CHILD: 1,
			EXCEPTION: 2,
			REASON: 3
		};

		var preLog = "addHostToPipelineGroup - ";
		var util = new AE_Utility();

		// Concatenation of all the Node set names. (possibly replace concatenation logic with node set record numer u_number)
		var concatNS = "";

		if (this.excluded[node_sysid]) {
			if(this.excluded[node_sysid][3] == 1)
				{	
					this._log.debug(preLog + "node:" + node + " excluded by:" + this.excluded[node_sysid][1] + " because:" + this.excluded[node_sysid][2],'',node,'node-excluded');
				}
			else if(this.excluded[node_sysid][3] == 0)
				{
					this._log.debug(preLog + "Nodeset:" + this.excluded[node_sysid][1] + " excluded because:" +  this.excluded[node_sysid][2]  ,'',this.excluded[node_sysid][1],'nodeset-excluded');
				}
			else
				{					
					
					this._log.debug(preLog + "node:" + node + " excluded by:" + this.excluded[node_sysid][1] + " because:" + this.excluded[node_sysid][2]);
				}
			return;
		}

		// Has this node be processed before ... if we have been here before ... then no need to process this node again.
		if (this.systems[node]) return;
			else {
			var targetRelease = "";
			var system = new GlideRecord("cmdb_ci_computer");
			system.addQuery('name', node);
			system.query();

			while (system.next()) {
				var sysos = system.os;
				if (system.sys_id.toString() != node_sysid) continue;				

				this._log.trace(preLog + "node:" + node + " sys_class_name:" + system.sys_class_name);

				// for now we are only interested in generating changes for linux or windows.
				if (system.sys_class_name == "cmdb_ci_linux_server") {
					targetRelease = (system.u_hp_managed) ? this.linuxRelease.toString() : this.smdcLinuxRelease.toString();
				} else if (system.sys_class_name == "cmdb_ci_win_server") {
					// -*- V73 Changed to have separate patch labels for Sabre & DXC windows
					targetRelease = (system.u_hp_managed) ? this.windowsRelease.toString() : this.smdcWindowsRelease.toString();
				} else if ((system.sys_class_name == "cmdb_ci_computer") && (sysos.includes("Windows"))) {
					// -*- V73 Changed to have separate patch labels for Sabre & DXC windows
					targetRelease = (system.u_hp_managed) ? this.windowsRelease.toString() : this.smdcWindowsRelease.toString();
				} else if ((system.sys_class_name == "cmdb_ci_server") && (sysos.includes("Windows"))) {
					// -*- V73 Changed to have separate patch labels for Sabre & DXC windows
					targetRelease = (system.u_hp_managed) ? this.windowsRelease.toString() : this.smdcWindowsRelease.toString();
				} else if ((system.sys_class_name == "cmdb_ci_server") && (sysos.includes("Linux"))) {
					targetRelease = (system.u_hp_managed) ? this.linuxRelease.toString() : this.smdcLinuxRelease.toString();
			    } else {
					this._log.warn(preLog + "QA this node(" + node + ") as it has an unsupported baseclass (" + system.sys_class_name + ")",'',node,'unsupported-os');
					return;
				}

				// is ci valid for processing .   we dont process retired servers or servers that are not active.
				if (!util.validateCI(node_sysid)) {
					// -*- V35.31 added trace messaged to help debug servers not being scheduled.
					this._log.trace(preLog + "This server excluded (" + node + ") as it is not active");
					continue;
				}

				// This system has already been patched at this level...  do not process.
				if (targetRelease == system.u_patching_block_point) {
					// -*- V35.31 added trace messaged to help debug servers not being scheduled.
					this._log.trace(preLog + "This server excluded (" + node + ") as it is already Patched at target level");
					return;
				}

				// This system has already been patched at a level higher than what is requested...  do not process.
				if (targetRelease < system.u_patching_block_point)  {
					// -*- V35.31 added trace messaged to help debug servers not being scheduled.
					this._log.trace(preLog + "This server excluded (" + node + ") as it is already Patched at > target level");
					return;
				}

				// dont process an systems that have already been scheduled.
				if (this.scheduled[node])  {
					// -*- V35.31 added trace messaged to help debug servers not being scheduled.
					this._log.trace(preLog + "This server (" + node + ") has already been scheduled");
					return;
				}

				// Populate member nodeset members into collection so we only have to process it once when it is first seen
				// name , patch label, sys_id, exclude flag, system class
				this.systems[node] = [ node, system.u_patching_block_point.toString(), system.sys_id.toString(), false, system.sys_class_name.toString() ];

				break;
			}
			// exit for this system if not found or not valid
			if (!this.systems[node]) return;
		}

		var exceptionFlag = false;
		// Query for all my parents.  How many node sets does the child belong to.

		for (var i = 0; i < this.ns_relation_cache.length; i++) {
			// is this one of my parent relationships ?
			if (this.ns_relation_cache[i][col.CHILD] == node) {
				var nodesetName = this.ns_relation_cache[i][col.PARENT];

				// get node set attributes.
				for (var j = 0; j < this.ts_relation_cache.length; j++) {
					if (this.ts_relation_cache[j][col.CHILD] == nodesetName) {
						// does my parent node set have the exception flag set ?
						if (this.ts_relation_cache[j][col.EXCEPTION]) {
							this._log.debug(preLog + "Node set (" + nodesetName +
							") has the exception flag set,\nnode(" + node +
							") will not be scheduled for change\n" +
							this.ts_relation_cache[j][col.REASON]);
							exceptionFlag = true;
							break;
						}
					}
				}
				if (exceptionFlag) continue;

				if (concatNS == "") {
					// first node in name list
					concatNS = nodesetName;
				} else {
					// concatenate additional relationships onto name list
					concatNS = concatNS.concat("^", nodesetName);
				}
			}
		}

		//  the service owner has set the exception flag on the node set
		// so this system will not be patched.
		if (exceptionFlag) {
			// store exception for this node in case we need it later
			this.systems[node][3] = true;
			// no need to stick around in this method anymore.
			return;
		} else {
			// trim for good measure
			concatNS = concatNS.trim();
		}

		// For each pipeline group that share common nodeset parents add the node to the group.
		if (this.pipelines.hasOwnProperty(concatNS)) {
			//  The common pipeline group of nodesets already exist..  add this node to the pipeline
			var nodelist = this.pipelines[concatNS];
			if (nodelist.indexOf(node) == -1) {
				// this node does not exist in the node list yet.  concatenate it into the membership list.
				nodelist = nodelist.concat("^", node);
				nodelist = nodelist.trim();
				// refresh pipeline list with new updated node list.
				this.pipelines[concatNS] = nodelist;
			}
		} else {
			// this pipeline does not exist yet .   create a new pipeline with the initial node member.
			this.pipelines[concatNS] = node;
		}
	},
	//************************************************************
	//
	// utility function to print out the pipeline groups we have
	// compiled together
	//
	//************************************************************
	printPipelineGroups: function() {

		var preLog = "PipelineGroups - ";

		var count = 0;
		var maxNodeSetCount = 0;
		var maxnodeCount = 0;
		for (var nodeset in this.pipelines) {
			count++;
			this._log.trace(preLog + "Pipeline Count = " + count);
			// split out the node set names from the name of the current pipeline
			var tokens = nodeset.split("^");
			var arrayLength = tokens.length;
			maxNodeSetCount = Math.max(maxNodeSetCount, arrayLength);
			var tokencount = 0;

			// print out every nodeset that has applictions in this pipeline
			for (var i = 0; i < arrayLength; i++) {
				tokencount = i + 1;
				this._log.trace(preLog + "     " + tokencount + "-" + tokens[i]);
			}

			// split out the systems in the pipeline list
			tokens = this.pipelines[nodeset].split("^");
			arrayLength = tokens.length;
			maxnodeCount = Math.max(maxnodeCount, arrayLength);
			// print out every system in this pipeline
			for (i = 0; i < arrayLength; i++) {
				tokencount = i + 1;
				this._log.trace(preLog + "          " + tokencount + "-" + tokens[i]);
			}
		}
		this._log.trace(preLog + "Max Node Set Count = " + maxNodeSetCount);
		this._log.trace(preLog + "Max Node Count = " + maxnodeCount);
	},
	//************************************************************
	//
	// iterate through all nodeset associated with a runs on
	// relationship.  Then add them to a pipeline group
	//
	//************************************************************
	groupNodesets: function() {
		var col = {
			PARENT: 0,
			CHILD: 1,
			SYSID: 2
		};

		for (var i = 0; i < this.ns_relation_cache.length; i++) {
			this.addHostToPipelineGroup(this.ns_relation_cache[i][col.CHILD], this.ns_relation_cache[i][col.SYSID]);
		}

		this.printPipelineGroups();
	},
	//************************************************************
	//
	// iterate through all pipelines and summarize attributes so
	// the group is compatible with the nodeset population
	//
	//************************************************************
	summarizePipelineAttributes: function() {
		var count = 0;
		var maxNodeSetCount = 0;
		var maxnodeCount = 0;
		var sorterRow = 0;
		var tokens = { };
		var arrayLength = 0;
		var tokencount = 0;

		// each record in the piplines collection contains a list of servers who share a common
		// unique relationship with a list of applications that execute on them.
		for (var nodesetlist in this.pipelines) {

			// we want to sort the pipelines so that they can be processed in a logical order.
			// for every nodesetlist in the pipeline we will create a record to the sort
			// collection.
			sorterRow = this.pipelineSorter.length;

			// create a new row with 'parent nodeset list', 'node list', 'delay',
			//    'total delay', 'Batch Size', 'cycle time' and 'Predecessor nodeset list'
			this.pipelineSorter[sorterRow] = [ nodesetlist, this.pipelines[nodesetlist], 0, 0, 1000, 0, "" ];

			// breakout the nodesets from nodesetlist
			tokens = nodesetlist.split("^");
			arrayLength = tokens.length;
			tokencount = 0;

			// Adjust batch size and execution order by examining sorted nodeset array
			for (var i = 0; i < arrayLength; i++) {
				// make token more readable in code
				var currentNodeSet = tokens[i];
				// search for the nodeset row in the nodesetSorter Array
				for (var myrow = 0; myrow < this.nodesetSorter.length; myrow++) {

					// does this row match the current nodeset name in my token list?
					if (this.nodesetSorter[myrow][this.column.NSNAME] == currentNodeSet) {
						// Apply common attributes to the pipeline.  Considering the systems in each pipeline,
						// The pipeline attributes should consider the contain the maximum delay, and
						// minimum batch size
						this.pipelineSorter[sorterRow][this.column.DELAY] =
						Math.max(this.pipelineSorter[sorterRow][this.column.DELAY] + 0,
						this.nodesetSorter[myrow][this.column.DELAY]) + 0;
						this.pipelineSorter[sorterRow][this.column.TOTALDELAY] =
						Math.max(this.pipelineSorter[sorterRow][this.column.TOTALDELAY] + 0,
						this.nodesetSorter[myrow][this.column.TOTALDELAY]) + 0;
						this.pipelineSorter[sorterRow][this.column.BATCHSIZE] =
						Math.min(this.pipelineSorter[sorterRow][this.column.BATCHSIZE] + 0,
						this.nodesetSorter[myrow][this.column.BATCHSIZE]) + 0;
						this.pipelineSorter[sorterRow][this.column.CYCLETIME] =
						Math.max(this.pipelineSorter[sorterRow][this.column.CYCLETIME] + 0,
						this.nodesetSorter[myrow][this.column.CYCLETIME]) + 0;


						// concatente all the predecessors from all nodesets
						if (this.pipelineSorter[sorterRow][this.column.PREDLIST] == "") {
							this.pipelineSorter[sorterRow][this.column.PREDLIST] =
							this.nodesetSorter[myrow][this.column.PREDLIST];
						} else {
							var nodeset = this.nodesetSorter[myrow][this.column.PREDLIST].split("^");
							var predecessors = nodeset.length;

							for (var ix = 0; ix < predecessors; ix++) {
								// is this nodeset already listed as a predecessor
								if (this.pipelineSorter[sorterRow][this.column.PREDLIST].indexOf(nodeset[ix]) == -1) {
									// not found in string so add it.
									this.pipelineSorter[sorterRow][this.column.PREDLIST] =
									this.pipelineSorter[sorterRow][this.column.PREDLIST].concat("^", nodeset[ix]);
								}
							}
						}

						break; // found match for this nodeset name no need to iterate more in this for loop
					}
				}
			}
		}
		this.printOutPipelineSorter();
		this.pipelineSorter.sort(this.bytotalDelay);
		this.printOutPipelineSorter();
	},
	//*************************************************************
	//
	// Now that the pipeline candidate list is in order we can
	// walk through the each one and schedule it while scaning for
	// predicessors that have already been scheduled.
	//
	//*************************************************************

	// utility to print out the contents of the pipelineSorter row.
	_printPipeLineRow: function(myRow) {

		var preLog = "PipelineRow - ";

		// seperate debug logging into sections.
		if (this._log.getLevel() == AE_Log.TRACE) {
			this._log.trace(preLog + " ");
			this._log.trace(preLog + "========================================================================");
			this._log.trace(preLog + " ");

			// iterate through finished array and print out contents.
			this._log.trace(preLog + "Node Set List     = " + this.pipelineSorter[myRow][this.column.NSLIST]);
			this._log.trace(preLog + "Node Name List    = " + this.pipelineSorter[myRow][this.column.NODELIST]);
			this._log.trace(preLog + "Duration          = " + this.pipelineSorter[myRow][this.column.DELAY]);
			this._log.trace(preLog + "Total Duration    = " + this.pipelineSorter[myRow][this.column.TOTALDELAY]);
			this._log.trace(preLog + "Batch Size        = " + this.pipelineSorter[myRow][this.column.BATCHSIZE]);
			this._log.trace(preLog + "Cycle Time        = " + this.pipelineSorter[myRow][this.column.CYCLETIME]);
			this._log.trace(preLog + "Predecessor List  = " + this.pipelineSorter[myRow][this.column.PREDLIST]);
		}
	},
	_getPreferredHour: function(myrow) {
		var nodeSetList = this.pipelineSorter[myrow][this.column.NSLIST].split("^");
		var nodeSetCount = nodeSetList.length;
		var startPreferred = 100;

		// lets find the earliest preferred time among the impacted nodesets from this pipeline
		for (var nsli = 0; nsli < nodeSetCount; nsli++) {
			var uns = new GlideRecord('u_node_sets');
			uns.addQuery('name', nodeSetList[nsli]);
			uns.query();
			if (uns.next()) {
				if ((uns.u_preferred_start_hour) && (uns.u_preferred_start_hour.toString().length > 0)) {
					var preferred_start_hour = parseInt(uns.u_preferred_start_hour);

					// if the preferred hour is early morning add 24 hours .
					if (preferred_start_hour < 6) preferred_start_hour += 24;
						if (preferred_start_hour < startPreferred) startPreferred = preferred_start_hour;
					}
			}
		}

		if (startPreferred == 100) startPreferred = -1;
			this._log.trace("startPreferred = " + startPreferred);
		return startPreferred;
	},
	_getDefaultStartTime: function() {
		// compute times to start searching for change window
		var default_start_time = new GlideDateTime();

		// For now lets default to a start time that is the beginning of our standard maintenance window
		// We probably need to change this for non prod environments.
		var dateStr = default_start_time.getYearLocalTime() + "-" + default_start_time.getMonthLocalTime() + "-" + default_start_time.getDayOfMonthLocalTime();
		dateStr = dateStr + " 09:00:00";
		default_start_time.setDisplayValue(dateStr);

		// To compute lead time we need a DurationCalculator object.
		var dc = new DurationCalculator();
		dc.setStartDateTime(default_start_time);

		//  Load the "8-5 weekdays excluding holidays" schedule into our duration calculator.
		var scheduleName = "U.S. Holidays";
		var grSched = new GlideRecord('cmn_schedule');
		grSched.addQuery('name', scheduleName);
		grSched.query();

		if (grSched.next()) {
			dc.setSchedule(grSched.getUniqueValue());
			if (dc.calcDuration(this.leadTime)) {
				default_start_time = new GlideDateTime(dc.getEndDateTime());
				//default_start_time = dc.getEndDateTime();
			} else {
				this._log.error(preLog + "*** Error calculating duration for lead time");
			}
		} else {
			this._log.error(preLog + '*** Could not find schedule to compute lead time"' + scheduleName + '"');
		}
		return default_start_time;
	},
	_predessorAdjustStartTime: function(myrow, default_start_time) {
		var foundPredecessor = false;
		var preLog = "_predessorAdjustStartTime - ";
		var col = {
			PARENT: 0,
			CHILD: 1,
			EXCEPTION: 2,
			REASON: 3
		};
		
		this._log.trace(preLog + "MyRow:" + myrow + "default_start_time:" + default_start_time);

		this._printPipeLineRow(myrow);

		var nodeList = this.pipelineSorter[myrow][this.column.NODELIST].split("^");

		var firstnode = nodeList[0];

		// parse out node set list and find the predicessor nodeset to each of them if they exist
		// for each predicessor nodeset search each node and store latest scheduled run
		var predecessorObj = { };

		predecessorObj.bail = false;
		predecessorObj.schedule_start_time = new GlideDateTime(default_start_time);
		// -*- V57 rkk updated to make sure empty string does not create an array with empty element
		if(gs.nil(this.pipelineSorter[myrow][this.column.PREDLIST]))
			{
				predecessorObj.lowerEnvList =[];
			}
		else
			{
				predecessorObj.lowerEnvList = this.pipelineSorter[myrow][this.column.PREDLIST].split("^");
			}
		
		predecessorObj.preReqSystem = "";

		var predecessors = predecessorObj.lowerEnvList.length;

		// we need to find out the latest scheduled predecessor to have a base date to schedule from
		// if all predecessors have not been scheduled we can not schedule this pipeline.
		for (var i = 0; i < predecessors; i++) {
			for (var j = 0; j < this.ns_relation_cache.length; j++) {
				if (this.ns_relation_cache[j][col.PARENT] == predecessorObj.lowerEnvList[i]) {
					foundPredecessor = true;
					var nodeName = this.ns_relation_cache[j][col.CHILD].toString();
					if (this.scheduled[nodeName]) {
						var end_datetime = new GlideDateTime(this.scheduled[nodeName].endDate);
						if (end_datetime > predecessorObj.schedule_start_time) predecessorObj.schedule_start_time = new GlideDateTime(end_datetime);
						// test if noCadence is expected .  if true then we should not schedule current system because a predecessor is sceheudled.
						if (this.noCadence == true) {
							this._log.trace("previous node:" + nodeName + " is currently scheule and not implemented yet");
							// Because we are not scheduleing cadence, if the predessor is scheduled but not implemented yet.
							// lets not do this change yet.
							predecessorObj.preReqSystem = nodeName;
							predecessorObj.bail = true;
							break;
						}
					} else {
						// only systems that do not have a the current patch level should be populagted in the systems collection.
						if (this.systems[nodeName]) {
							// This system has not been scheduled yet it is a predecessor of the current sytgems being processed
							// Something wrong with cadence as predecessors should be either compliant or scheduled
							this._log.debug("previous node:" + nodeName + " predecessor has not been scheduled yet");
							predecessorObj.preReqSystem = nodeName;
							predecessorObj.bail = true;
							break;
						} else {
							// doesnt exist in systems and not scheduled maning it is compliant.
							this._log.trace("previous node:" + nodeName + " is not listed");
						}
					}
				}
			}
			if (predecessorObj.bail) break;

			// strip off limited nodes from predessor list if they exist
			predecessorObj.lowerEnvList[i] = predecessorObj.lowerEnvList[i].replace("LimitedNodes-", "");
		}

		// now that we have changed the start time to be at least equal to the latest predecessors end time.
		// add in the schedule delay
		if (foundPredecessor) {
			predecessorObj.schedule_start_time.addSeconds(this.pipelineSorter[myrow][this.column.DELAY] * 3600);
		}

		return predecessorObj;
	},

	/* -*-
	*
	* This utility function is for printing the list of nodes with their current patching block level
	* 'step' is the text to be printed before printing the nodes as this method will be call before and after sorting the list
	* 'systemAttributeNodes' is the array containing the target nodes
	*
	*/
	printSystemAttributeNodes: function(step,systemAttributeNodes) {
		var preLog = "SystemAttributeNodeList - ";

		// -*- seperate debug logging into sections.
		if (this._log.getLevel() == AE_Log.TRACE) {
			this._log.trace(preLog + " ");
			this._log.trace(preLog + "========================================================================");
			this._log.trace(preLog + step);
			this._log.trace(preLog + "========================================================================");
			this._log.trace(preLog + " ");

			if (this.csv) this._log.trace(preLog + "System Name,Patching Block Level");
				// -*- iterate through the node list and print out node name and it's corresponding patching block level from this.systems.
			for (var saNode = 0; saNode < systemAttributeNodes.length; saNode++) {
				if (this.csv) {
					this._log.trace(preLog + systemAttributeNodes[saNode]+ "," +
					this.systems[ systemAttributeNodes[saNode]][1]);
				} else {

					this._log.trace(preLog + "System Name          = " + systemAttributeNodes[saNode]);
					this._log.trace(preLog + "Patching Block Level = " + this.systems[ systemAttributeNodes[saNode]][1]);
					this._log.trace(preLog + "===================");
				}
			}
		}
	},



	_getTargetSystemAttributes: function(myrow) {
		var preLog = "_getTargetSystemAttributes - ";
		var objReturn = { };
		objReturn.duration = 0;
		objReturn.hp_managed = false;
		objReturn.releaseLabel = "";
		objReturn.nodeCount = 0;

		// Which patch are we appling
		objReturn.targetNodes = this.pipelineSorter[myrow][this.column.NODELIST].split("^");


		objReturn.nodeCount = objReturn.targetNodes.length;

		try {
			var gr = new GlideRecord('cmdb_ci_computer');
			gr.addQuery('sys_id', this.systems[objReturn.targetNodes[0]][2]);
			gr.query();
			if (gr.next()) {
				if (gr.sys_class_name == 'cmdb_ci_linux_server') {
					objReturn.releaseLabel = (gr.u_hp_managed) ? this.linuxRelease.toString() : this.smdcLinuxRelease.toString();
					objReturn.duration = this.linuxReleaseDuration;
				} else if (gr.sys_class_name == 'cmdb_ci_win_server') {
					// -*- V73 Changed to have separate patch labels for Sabre & DXC windows
					objReturn.releaseLabel = (gr.u_hp_managed) ? this.windowsRelease.toString() : this.smdcWindowsRelease.toString();
					objReturn.duration = this.windowsReleaseDuration;
				} else if (gr.sys_class_name == 'cmdb_ci_computer') {
					if (gr.os.includes("Windows")) {
						// -*- V73 Changed to have separate patch labels for Sabre & DXC windows
						objReturn.releaseLabel = (gr.u_hp_managed) ? this.windowsRelease.toString() : this.smdcWindowsRelease.toString();
						objReturn.duration = this.windowsReleaseDuration;
					}
				}
				if (gr.u_hp_managed) {
					objReturn.hp_managed = true;
				}
			}
		} catch (exception) {
			this._log.exception(preLog + " pipeline:" + this.pipelineSorter[myrow][this.column.NODELIST] +
			" nodeCount:" + objReturn.nodeCount +
			" exception:" + exception,AE_Global.PATCH_AUTOMATION_TS,'exception');
		}

		// -*- Sort the target node list by current patching block level so that the nodes with older patching block are prioritized
		// -*- Printing to trace before sorting
		this.printSystemAttributeNodes("Before Sorting the System List in system attribute targetNodes by current patching block level for pipeline with Node Set List : '" +
									   this.pipelineSorter[myrow][this.column.NSLIST]+"'",objReturn.targetNodes);

		// -*- Sorting
		// -*- Assigning this.systems to a temporary variable as this.systems can't be directly used inside the sort method
		var tempSystems=this.systems;
		objReturn.targetNodes.sort(function(a, b) {
		patchLevelA=tempSystems[a][1];
		patchLevelB=tempSystems[b][1];
		if (patchLevelA < patchLevelB) return -1;
			if (patchLevelA > patchLevelB) return 1;
			return 0;
	});

		// -*- Printing to trace after sorting
		this.printSystemAttributeNodes("After Sorting the System List in system attribute targetNodes by current patching block level for pipeline with Node Set List : '" +
									   this.pipelineSorter[myrow][this.column.NSLIST]+"'",objReturn.targetNodes);

		return objReturn;
	},
	_getMaxBatchSeqLength: function(nodeSets) {
		var preLog = "_getMaxBatchSeqLength - ";

		// Find out the max number of batches that can be in a pipeline
		var nodesetList = nodeSets.split("^");
		var nodesetCount = nodesetList.length;
		var batchSeqLen = 100;

		// iterate every nodeset an populate our mask
		for (var inodeset = 0; inodeset < nodesetCount; inodeset++) {
			// iterate through each nodeset , retrieve the minimum batch sequence length
			// Strip out limitied nodes prefix or it wont find the nodeset
			nodesetList[inodeset] = nodesetList[inodeset].replace("LimitedNodes-", "");

			var nodesetq = new GlideRecord("u_node_sets");
			nodesetq.addQuery('name', nodesetList[inodeset]);
			nodesetq.query();

			while (nodesetq.next()) {
				if (nodesetq.u_batch_sequence_length > 0) {
					if (batchSeqLen > nodesetq.u_batch_sequence_length) batchSeqLen = nodesetq.u_batch_sequence_length;
					}
			}
		}
		return batchSeqLen;
	},
	scheduleChanges: function() {
		var changeCount = 0;
		var preLog = "scheduleChanges - ";

		// compute times to start searching for change window
		var default_start_time = this._getDefaultStartTime();

		for (var myrow = 0; myrow < this.pipelineSorter.length; myrow++) {

			//  Exit change generation if we have been told to do so.
			if (gs.getProperty('aed.script.stop', "false") == "true") {
				this._log.info("Forced Exit");
				break;
			}

			//if (myrow > 10 ) break;
			var pipeline = [ ];
			var serverNameList = [ ];  // we need to export pipeline as server names not sys_id
			var pipelineString = "";
			var nsBatchSeqLen = this._getMaxBatchSeqLength(this.pipelineSorter[myrow][this.column.NSLIST]);


			// Create pipeline details needed for Orchestration.
			var batchSizeLimit = Math.floor(Math.min(this.pipelineSorter[myrow][this.column.BATCHSIZE], this.maxBatchNodes));
			var appCycleTime = this.pipelineSorter[myrow][this.column.CYCLETIME];

			// look for nodeset dependencies and when the the predecessors
			// was scheduled .  make sure we account for the delay gap.
			var predecessors = this._predessorAdjustStartTime(myrow, default_start_time);

			// Which patch are we appling
			var systemAttributes = this._getTargetSystemAttributes(myrow);
			if (systemAttributes.duration == 0) {
				this._log.info(preLog + "Skipping - Nodesets do not appear to linux or windows" +
				this.pipelineSorter[myrow][this.column.NSLIST]);
				continue;
			}

			var startPreferred = this._getPreferredHour(myrow);

			// we will use this.maxDuration as a max default change window,  this allows us to break up the changes into smaller chunks
			// larger windows will have more potential conflicts when scheduling.
			// -*- V35 Added contingency time for each batch from property while calculating max bathes 
			var maxBatches = Math.min(parseInt((this.maxDuration - this.contengency) / ((systemAttributes.duration * 60) + appCycleTime + this.batchContingencySeconds  )), nsBatchSeqLen);

			// compute the number of nodes to process to populate the batches
			var maxChangeNodes = parseInt(batchSizeLimit * maxBatches);

			// counter the number of nodes in each pipeline
			var nodeCounter = 0;
			// we need to format the pipeline list into sys_id values for the template object.
			for (var ix = 0; ix < systemAttributes.nodeCount; ix++) {
				if (nodeCounter == 0) {
					pipeline = [ ];
					serverNameList = [ ];
					pipelineString = "";
				}
				pipeline.push(this.systems[systemAttributes.targetNodes[ix]][2]);
				pipelineString = pipelineString.concat(systemAttributes.targetNodes[ix].toString(), " ");
				serverNameList.push(systemAttributes.targetNodes[ix]);

				nodeCounter++;

				// have we reached the pipeline limit ? if not continue else generate change.
				if ((nodeCounter < maxChangeNodes) && (ix < (systemAttributes.nodeCount - 1))) continue;

				// if predecessor nodes have not been implemented then dont proceed with this change.
				// also test if we have reached the runtime change maximum count
				if ((!predecessors.bail) && (changeCount < this.maxNewChanges)) {
					this._log.debug(preLog + "Schedule Start Time Begin:" + predecessors.schedule_start_time.toString());


					//  Exit change generation if we have been told to do so.
					if (gs.getProperty('aed.script.stop', "false") == "true") {
						this._log.info("Forced Exit");
						break;
					}

					// the number of batches in the pipeline will impact the requested change duration.
					var schedule_end_time = new GlideDateTime(predecessors.schedule_start_time);
					var batches = Math.ceil(nodeCounter / batchSizeLimit);
					// -*- V35 Added contingency time for each batch from property and change the logging statement below
					var duration = (batches * ((systemAttributes.duration * 60) + appCycleTime + this.batchContingencySeconds )) + this.contengency;

					this._log.trace(preLog + "Batches:" + batches + " PatchDuration:" + systemAttributes.duration +
					" CycleTime:" + appCycleTime + "Batch Contingency(secs) : " + this.batchContingencySeconds + " Change Contingency:" + this.contengency + " totalDuration:" + duration);

					schedule_end_time.addSeconds(duration);

					// create a CR
					var cr = new AE_CR_Patching();

					var changeCriteria = { };
					changeCriteria.pipeline = pipeline;
					changeCriteria.batchSize = batchSizeLimit;
					changeCriteria.maintenanceEvent = systemAttributes.releaseLabel;
					changeCriteria.systemList = serverNameList;
					changeCriteria.startTime = predecessors.schedule_start_time;
					changeCriteria.endTime = schedule_end_time;
					changeCriteria.lowerEnvList = predecessors.lowerEnvList;
					changeCriteria.preferredStartHour = startPreferred;
					if (systemAttributes.hp_managed) {
						changeCriteria.scheduleUtil = this.scheduleUtil;
					} else {
						changeCriteria.scheduleUtil = this.scheduleUtilSNOW;
					}

					if (systemAttributes.hp_managed) {
						// build BLOCK day of week mask for this pipeline
						this.scheduleUtil.setDOWMask(this.pipelineSorter[myrow][this.column.NSLIST]);
						this.scheduleUtil.blockDay(this.excludeDOW);
					} else {
						// build BLOCK day of week mask for this pipeline
						this.scheduleUtilSNOW.setDOWMask(this.pipelineSorter[myrow][this.column.NSLIST]);
					}

					// schedule the CR
					if (!cr.buildChangeRequest(changeCriteria)) {
						this._log.debug(preLog + "Failed to create change request!\n" + cr.getInfoText());
					} else {
						cr.commitChangeRequest();
						this._log.debug(preLog + "CR (" + cr.current.number + ") created successfully (" +
						pipelineString + ")\n" + cr.getInfoText());

						// lets update our local collection to show these systems have beeen scheduled
						for (var k = 0; k < systemAttributes.nodeCount; k++) {
							this.scheduled[systemAttributes.targetNodes[k]] = {
								nameID: this.systems[systemAttributes.targetNodes[k]][2],
								crID: cr.getChangeRecordID(),
								patchStr: changeCriteria.maintenanceEvent, // Target patch level that the CR is for
								endDate: cr.current.end_date.toString()
							};
						}


						// Now that we have added a change .lets keep our change list up todate
						this.changes[cr.current.number] = {
							startDate: cr.current.start_date.toString(),
							endDate: cr.current.end_date.toString(),
							batchSize: batchSizeLimit
						};

						// update our reserved batch slots.
						if (systemAttributes.hp_managed) {
							this.scheduleUtil.reserveTimeSlots(this.changes[cr.current.number].startDate,
							this.changes[cr.current.number].endDate,
							this.changes[cr.current.number].batchSize);
						} else {
							this.scheduleUtilSNOW.reserveTimeSlots(this.changes[cr.current.number].startDate,
							this.changes[cr.current.number].endDate,
							this.changes[cr.current.number].batchSize);
						}

						// to support subsequent remaining nodes changes reset start time to
						// begin searching after the end of this change for remaining nodes implementation.
						// this._log.debug(preLog + "CR:" + cr.current.number + " BatchCount:" + batches + " NodeSet Batch Limit:" + maxBatches);
						if (batches == maxBatches) {
							// if we have reached the target number of batches assume only one per maintenance window is wanted.
							// start looking for next change in the next day.
							predecessors.schedule_start_time = new GlideDateTime(cr.current.start_date);
							predecessors.schedule_start_time.addDaysLocalTime(1);
						}
						changeCount++;
					}
				} else {
					if (predecessors.bail) {
						this._log.debug(preLog + "This pipeline (" + this.pipelineSorter[myrow][this.column.NODELIST] +
						")\n will not be scheduled as predecessor node (" + predecessors.preReqSystem +
						") has not been scheduled");
					} else {
						this._log.debug(preLog + "Change creation has reached daily maximum threashold");
						myrow = this.pipelineSorter.length;
					}
				}

				// reset counter for counting change nodes
				nodeCounter = 0;
			}
		}

		this._log.debug(preLog + "Change creation has completed!");
	},
	//*************************************************************
	//
	// Query relation table to find all systems related to nodesets relations.
	//    targetName can be either node set or technical service name.
	//*************************************************************
	generatePipelines: function(targetName) {
		var justThisOne = "";
		if (arguments.length > 0) justThisOne = targetName.toString();
		try {
			this._log.info("Begin");
			//  Exit change generation if we have been told to do so.
			if (gs.getProperty('aed.script.stop', "false") == "false") {
				// create a list of systems that have already been scheduled for patching.  we want to skip these.
				this.scheduled = AE_CR_Patching.getActivePatchingServersObj();
				// create a list of active changes.
				this.changes = AE_CR_Patching.getActiveChangeRequests();
				// populate
				for (var change in this.changes) {
					if (this.changes[change].automationType == 2) {
						this.scheduleUtil.reserveTimeSlots(this.changes[change].startDate,
						this.changes[change].endDate,
						this.changes[change].batchSize);
					} else {
						this.scheduleUtilSNOW.reserveTimeSlots(this.changes[change].startDate,
						this.changes[change].endDate,
						this.changes[change].batchSize);
					}
				}
				//  Exit change generation if we have been told to do so.
				if (gs.getProperty('aed.script.stop', "false") == "false") {
					// this function will put the nodeset in order of execution through our environments using sequence and delay variables
					this.initializeNodesetSorter(justThisOne.toString());
					// Collect nodes with common nodeset relationships.
					this.groupNodesets();
					// summarize the attributes of the pipeline groups and sort into processing order for scheduling
					this.summarizePipelineAttributes();
					// changes for the generated pipelines.
					//  if (true) return;
					this.scheduleChanges();
				} else {
					this._log.info("Forced Exit");
				}
			} else {
				this._log.info("Forced Exit");
			}
			this._log.info("Complete");
		} catch (exception) {
			this._log.exception(exception,AE_Global.PATCH_AUTOMATION_TS,'exception');
		}
	},
	type: 'AE_GenerateChanges'
};