var tasks = new GlideRecord('change_task');
tasks.addQuery('number','CTASK0010001');
tasks.query();
while(tasks.next()) {
     //gs.print(tasks.close_notes);
     var outstr = tasks.close_notes;
     if(outstr.toLowerCase().includes("gcp deploy app infrastructure")) {
        gs.print("Valid");
     } 
     else {
        gs.print("Invalid");
     }       
}






var tasks = new GlideRecord('change_task');
tasks.query();
while(tasks.next()) {
   var outstr = tasks.close_notes;
   //gs.print(tasks.number + " - " + tasks.change_request.getDisplayValue() + " - " + tasks.close_notes);
   outstr = tasks.close_notes;
   keystr = "gcp deploy app infrastructure"
   if(outstr.toLowerCase().includes(keystr)) {
      gs.print(tasks.number + " - " + tasks.change_request.getDisplayValue());
   }
   else {
      gs.print("Not found")
   }
}