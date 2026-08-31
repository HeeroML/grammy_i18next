-brand = Fluent
-thing = { $article ->
   *[definite] the thing
    [indefinite] a thing
}
-titled = Title
    .gender = feminine

simple = Just text
greeting = Hello, { $name }!
multiline =
    Line one
    Line two
about = Powered by { -brand }.
this-thing = This is { -thing(article: "indefinite") }.
term-attr = { -titled.gender ->
    [feminine] She
   *[masculine] He
  }
ref = { simple } and more.
emails = { $count ->
    [0] no emails
    [one] one email
   *[other] { $count } emails
  }
numeric = { $n ->
    [0] zero
    [1] exactly one
   *[other] many
  }
pi = PI is { NUMBER($pi, maximumFractionDigits: 2) }.
price = Total: { NUMBER($amount, minimumFractionDigits: 2) }
when = Date: { DATETIME($date, month: "long", day: "numeric", year: "numeric", timeZone: "UTC") }
login = Sign in
    .tooltip = Click to sign in as { $user }
noval =
    .attr = Only an attribute
unicode = Héllo — «{ $name }» ✔ 😀 ü
escaped = Braces { "{" } and { "}" } plus a quote { "\"" }
custom = Custom: { UPPER($word) }
dup = first
dup = second
