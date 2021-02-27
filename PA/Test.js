const Book = {
    summary : function() {
        console.log(`${this.title} is written by ${this.author}.`);
    }
}
const book1 = Object.create(Book);
book1.author = "Subbu";
book1.title = "This script";
console.log(book1.summary());