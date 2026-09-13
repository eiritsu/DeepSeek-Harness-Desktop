/** Type declaration for package-owned CSS Modules. */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}
