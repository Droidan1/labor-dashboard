/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        display: ['"Luckiest Guy"', 'cursive'],
        body: ['Poppins', 'sans-serif'],
      }
    }
  },
  plugins: [],
}
