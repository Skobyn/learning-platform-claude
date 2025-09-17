import Link from 'next/link'

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="container mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-6xl font-bold text-gray-900 mb-4">
            Enterprise Learning Platform
          </h1>
          <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto">
            Empower your organization with AI-powered learning paths, 
            comprehensive assessments, and digital certifications.
          </p>
          <div className="space-x-4">
            <Link href="/auth/login" className="btn-primary inline-block">
              Sign In
            </Link>
            <Link href="/auth/register" className="btn-secondary inline-block">
              Get Started
            </Link>
          </div>
        </div>
        
        <div className="grid md:grid-cols-3 gap-8 mt-16">
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="text-blue-600 mb-4">
              <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold mb-2">AI-Powered Courses</h3>
            <p className="text-gray-600">
              Generate comprehensive courses with AI assistance, 
              including quizzes, assessments, and interactive content.
            </p>
          </div>
          
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="text-blue-600 mb-4">
              <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 20 20">
                <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3z" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold mb-2">Role-Based Access</h3>
            <p className="text-gray-600">
              Secure user management with role-based permissions 
              for learners, instructors, and administrators.
            </p>
          </div>
          
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="text-blue-600 mb-4">
              <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                <path fillRule="evenodd" d="M4 5a2 2 0 012-2v1a1 1 0 002 0V3a2 2 0 012 2v6a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 1h2v4H7V6zm2 6H7v-1h2v1z" clipRule="evenodd" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold mb-2">Digital Certificates</h3>
            <p className="text-gray-600">
              Award verified digital certificates and badges 
              with blockchain verification and LinkedIn integration.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}