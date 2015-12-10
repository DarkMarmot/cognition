const g       = require("gulp-load-plugins")()
    , gulp    = require("gulp")

const paths = {
    src: "src/cognition.js",
    dist: "dist"
}

const src  = gulp.src.bind(gulp)
const dest = gulp.dest.bind(gulp)

gulp.task("copy", () => {
    src(paths.src).pipe(dest(paths.dist))
})

gulp.task("serve", () => {
    g.connect.server({
        root: paths.dist,
        livereload: process.env.RELOAD === "true" ? true : false
    })
})

gulp.task("reload", () => {
    src(paths.dist).pipe(g.connect.reload())
})

gulp.task("watch", () => {
    gulp.watch(paths.src, ["copy"])
})

const tasks = [
    "copy",
    "watch"
]

gulp.task("default", tasks)
