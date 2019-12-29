const {basename, resolve} = require('path')
const t = require('tap')
const Arborist = require('../..')
const registryServer = require('../fixtures/registry-mocks/server.js')
const {registry} = registryServer

// there's a lot of fs stuff in this test.
// Parallelize as much as possible.
t.jobs = Infinity
t.test('setup server', { bail: true, buffered: false }, registryServer)

// two little helper functions to make the loaded trees
// easier to look at in the snapshot results.
const printEdge = (edge, inout) => ({
  name: edge.name,
  type: edge.type,
  spec: edge.spec,
  ...(inout === 'in' ? {
    from: edge.from && edge.from.location,
  } : {
    to: edge.to && edge.to.location,
  }),
  ...(edge.error ? { error: edge.error } : {}),
  __proto__: { constructor: edge.constructor },
})

const printTree = tree => ({
  name: tree.name,
  location: tree.location,
  resolved: tree.resolved,
  // 'package': tree.package,
  ...(tree.extraneous ? { extraneous: true } : {
    ...(tree.dev ? { dev: true } : {}),
    ...(tree.optional ? { optional: true } : {}),
    ...(tree.devOptional && !tree.dev && !tree.optional
      ? { devOptional: true } : {}),
  }),
  ...(tree.inBundle ? { bundled: true } : {}),
  ...(tree.error
    ? {
      error: {
        code: tree.error.code,
        ...(tree.error.path ? { path: relative(__dirname, tree.error.path) }
          : {}),
      }
    } : {}),
  ...(tree.isLink ? {
    target: {
      name: tree.target.name,
      parent: tree.target.parent && tree.target.parent.location
    }
  } : {}),
  ...(tree.inBundle ? { bundled: true } : {}),
  ...(tree.edgesIn.size ? {
    edgesIn: new Set([...tree.edgesIn]
      .sort((a, b) => a.from.location.localeCompare(b.from.location))
      .map(edge => printEdge(edge, 'in'))),
  } : {}),
  ...(tree.edgesOut.size ? {
    edgesOut: new Map([...tree.edgesOut.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, edge]) => [name, printEdge(edge, 'out')]))
  } : {}),
  ...( tree.target || !tree.children.size ? {}
    : {
      children: new Map([...tree.children.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, tree]) => [name, printTree(tree)]))
    }),
  __proto__: { constructor: tree.constructor },
})

const { format } = require('tcompare')

const cwd = process.cwd()
t.cleanSnapshot = s => s.split(cwd).join('{CWD}')

const fixture = (t, p) =>
  t.testdir(require('../fixtures/reify-cases/' + p)(t))

const printReified = (path, opt) => reify(path, opt).then(printTree)

const reify = (path, opt) =>
  new Arborist({registry, path, ...(opt || {})}).reify(opt)

t.test('testing-peer-deps package', t => {
  const path = fixture(t, 'testing-peer-deps')
  return t.resolveMatchSnapshot(printReified(path), 'reify with peer deps')
})

t.test('testing-peer-deps nested', t => {
  const path = fixture(t, 'testing-peer-deps-nested')
  return t.resolveMatchSnapshot(printReified(path), 'reify ideal tree')
})

t.test('testing-peer-deps nested with update', t => {
  const path = fixture(t, 'testing-peer-deps-nested')
  return t.resolveMatchSnapshot(printReified(path, {
    update: { names: ['@isaacs/testing-peer-deps'] },
  }), 'can update a peer dep cycle')
})

t.test('tap vs react15', t => {
  const path = fixture(t, 'tap-react15-collision')
  return t.resolveMatchSnapshot(printReified(path),
    'build ideal tree with tap collision')
})

t.test('tap vs react15 with legacy shrinkwrap', t => {
  const path = fixture(t, 'tap-react15-collision-legacy-sw')
  return t.resolveMatchSnapshot(printReified(path),
    'tap collision with legacy sw file')
})

t.test('bad shrinkwrap file', t => {
  const path = fixture(t, 'testing-peer-deps-bad-sw')
  return t.resolveMatchSnapshot(printReified(path), 'bad shrinkwrap')
})

t.test('cyclical peer deps', t => {
  const paths = [
    'peer-dep-cycle',
    'peer-dep-cycle-with-sw',
  ]

  t.jobs = Infinity
  t.plan(paths.length)
  paths.forEach(path => t.test(path, t => {
    t.jobs = Infinity
    t.test('without upgrade', t =>
      t.resolveMatchSnapshot(printReified(fixture(t, path))))
    t.test('with upgrade', t =>
      t.resolveMatchSnapshot(printReified(fixture(t, path), {
        add: {
          dependencies: {
            '@isaacs/peer-dep-cycle-a': '2.x'
          }
        },
      })))
    t.test('conflict rejects as unresolvable', t =>
      t.rejects(printReified(fixture(t, path), {
        add: {
          dependencies: {
            // this conflicts with the direct dep on a@1 PEER-> b@1
            '@isaacs/peer-dep-cycle-b': '2.x',
          },
        },
      })))
    t.test('can add b@2 if we remove a@1 dep', t =>
      t.resolveMatchSnapshot(printReified(fixture(t, path), {
        add: {
          dependencies: {
            '@isaacs/peer-dep-cycle-b': '2.x',
          },
        },
        rm: [ '@isaacs/peer-dep-cycle-a' ],
      }), 'can add b@2 if we remove a@1 dep'))
    t.test('remove the dep, prune everything', t =>
      t.resolveMatchSnapshot(printReified(fixture(t, path), {
        rm: [ '@isaacs/peer-dep-cycle-a' ],
      }), 'remove the dep, prune everything'))
    t.end()
  }))
})

t.test('nested cyclical peer deps', t => {
  const paths = [
    'peer-dep-cycle-nested',
    'peer-dep-cycle-nested-with-sw',
  ]
  t.jobs = Infinity
  t.plan(paths.length)
  paths.forEach(path => t.test(path, t => {
    t.jobs = Infinity
    t.test('nested peer deps cycle', t =>
      t.resolveMatchSnapshot(printReified(fixture(t, path))))
    t.test('upgrade a', t =>
      t.resolveMatchSnapshot(printReified(fixture(t, path), {
        add: {
          dependencies: {
            '@isaacs/peer-dep-cycle-a': '2.x',
          },
        },
      })))
    t.test('upgrade b', t =>
      t.resolveMatchSnapshot(printReified(fixture(t, path), {
        add: {
          dependencies: {
            '@isaacs/peer-dep-cycle-b': '2.x',
          },
        },
      })))
    t.test('upgrade c', t =>
      t.resolveMatchSnapshot(printReified(fixture(t, path), {
        add: {
          dependencies: {
            '@isaacs/peer-dep-cycle-c': '2.x',
          },
        },
      })))
    t.test('try (and fail) to upgrade c and a incompatibly', t =>
      t.rejects(printReified(fixture(t, path), {
        add: {
          dependencies: {
            '@isaacs/peer-dep-cycle-a': '1.x',
            '@isaacs/peer-dep-cycle-c': '2.x',
          },
        },
      })))
    t.end()
  }))
})

t.test('bundle deps example 1', t => {
  // ignore the bundled deps when building the ideal tree.  When we reify,
  // we'll have to ignore the deps that got placed as part of the bundle.
  t.jobs = Infinity
  t.test('without update', t =>
    t.resolveMatchSnapshot(printReified(fixture(t, 'testing-bundledeps'))))
  t.test('bundle the bundler', t =>
    t.resolveMatchSnapshot(printReified(fixture(t, 'testing-bundledeps'), {
      add: {
        bundleDependencies: ['@isaacs/testing-bundledeps'],
      },
    })))
  t.end()
})

t.test('bundle deps example 2', t => {
  // bundled deps at the root level are NOT ignored when building ideal trees
  const path = 'testing-bundledeps-2'
  t.jobs = Infinity
  t.test('bundle deps testing', t =>
    t.resolveMatchSnapshot(printReified(fixture(t, path))))

  t.test('add new bundled dep c', t =>
    t.resolveMatchSnapshot(printReified(fixture(t, path), {
      add: {
        bundleDependencies: [ '@isaacs/testing-bundledeps-c' ],
      },
    })))

  t.test('remove bundled dep a', t =>
    t.resolveMatchSnapshot(printReified(fixture(t, path), {
      rm: ['@isaacs/testing-bundledeps-a'],
    })))

  t.end()
})

t.test('do not add shrinkwrapped deps', t => {
  const path = fixture(t, 'shrinkwrapped-dep-no-lock')
  return t.resolveMatchSnapshot(printReified(path))
})

t.test('do not update shrinkwrapped deps', t => {
  const path = fixture(t, 'shrinkwrapped-dep-with-lock')
  return t.resolveMatchSnapshot(printReified(path,
    { update: { names: ['abbrev']}}))
})

t.test('update', t => {
  t.jobs = Infinity

  t.test('flow outdated', t => {
    t.jobs = Infinity
    t.test('update flow', t =>
      t.resolveMatchSnapshot(printReified(fixture(t, 'flow-outdated'), {
        update: {
          names: [ 'flow-parser' ],
        },
      })))

    t.test('update everything', t =>
      t.resolveMatchSnapshot(printReified(fixture(t, 'flow-outdated'), {
        update: true,
      })))

    t.end()
  })

  t.test('tap and flow', t => {
    t.jobs = Infinity
    t.test('update everything', t =>
      t.resolveMatchSnapshot(printReified(fixture(t, 'tap-and-flow'), {
        update: {
          all: true,
        }
      })))

    t.test('update ink only', t =>
      t.resolveMatchSnapshot(printReified(fixture(t, 'tap-and-flow'), {
        update: {
          names: ['ink'],
        }
      })))

    t.end()
  })

  t.end()
})

t.test('multiple bundles at the same level')
t.test('update a node without updating its children')
t.test('adding a new shrinkwrap node')
